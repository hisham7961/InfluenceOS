import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SavedViewDTO, SearchPageDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/** Provision a throwaway STAFF (non-admin) user and return an auth header. */
async function loginStaff(app: FastifyInstance): Promise<{ auth: Record<string, string>; userId: string }> {
  const email = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { email, name: 'Test Staff', role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
  return { auth: { authorization: `Bearer ${tokens.accessToken}` }, userId: user.id };
}

/**
 * W3-6 — saved views/segments (persist + share filters) and the full ranked
 * search page (indexes notes + tags, returns a paginated ranked page).
 */
describe('W3-6 — saved views + ranked search page', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let influencerId: string;
  const tag = Date.now();
  const uniq = `zrq${tag}`; // a distinctive token to search for

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `SV Brand ${tag}` } }));
    // An influencer whose NAME does not contain the token, but a NOTE does — proves note indexing.
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Plain Creator ${tag}` } }));
    await app.inject({ method: 'POST', url: '/api/v1/notes', headers: auth, payload: { influencerId, body: `secret keyword ${uniq} in a note` } });
    // A second influencer whose display name contains the token directly (should outrank the note match).
    await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${uniq} Star` } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.savedView.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: String(tag) } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: uniq } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('ranks a direct name match above a note match, and reports matchedOn', async () => {
    const page = (await app.inject({ method: 'GET', url: `/api/v1/search/page?q=${uniq}&types=influencer`, headers: auth })).json() as SearchPageDTO;
    expect(page.total).toBeGreaterThanOrEqual(2);
    // The name-match creator ranks first; the note-only match is present but lower.
    expect(page.results[0]!.title).toBe(`${uniq} Star`);
    expect(page.results[0]!.matchedOn).toBe('name');
    const noteMatch = page.results.find((r) => r.title === `Plain Creator ${tag}`);
    expect(noteMatch).toBeTruthy();
    expect(noteMatch!.matchedOn).toBe('note');
    expect(page.results[0]!.score).toBeGreaterThan(noteMatch!.score);
  });

  it('paginates: page size limits results but total counts everything', async () => {
    const page = (await app.inject({ method: 'GET', url: `/api/v1/search/page?q=${uniq}&pageSize=1`, headers: auth })).json() as SearchPageDTO;
    expect(page.pageSize).toBe(1);
    expect(page.results).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it('creates, lists, updates and deletes a saved view; sharing controls visibility', async () => {
    const created = (await app.inject({
      method: 'POST', url: '/api/v1/saved-views', headers: auth,
      payload: { scope: `influencers-${tag}`, name: 'High priority KW', filters: { country: 'KW', priority: 'HIGH' } },
    })).json() as SavedViewDTO;
    expect(created.isOwn).toBe(true);
    expect(created.isShared).toBe(false);
    expect((created.filters as { country: string }).country).toBe('KW');

    const listed = (await app.inject({ method: 'GET', url: `/api/v1/saved-views?scope=influencers-${tag}`, headers: auth })).json() as SavedViewDTO[];
    expect(listed).toHaveLength(1);

    const updated = (await app.inject({
      method: 'PATCH', url: `/api/v1/saved-views/${created.id}`, headers: auth,
      payload: { name: 'High priority KW (shared)', isShared: true },
    })).json() as SavedViewDTO;
    expect(updated.name).toBe('High priority KW (shared)');
    expect(updated.isShared).toBe(true);

    // A different (non-admin) user sees the shared view but cannot edit it.
    const other = await loginStaff(app);
    const otherList = (await app.inject({ method: 'GET', url: `/api/v1/saved-views?scope=influencers-${tag}`, headers: other.auth })).json() as SavedViewDTO[];
    expect(otherList.map((v) => v.id)).toContain(created.id);
    expect(otherList.find((v) => v.id === created.id)!.isOwn).toBe(false);
    const forbidden = await app.inject({ method: 'DELETE', url: `/api/v1/saved-views/${created.id}`, headers: other.auth });
    expect(forbidden.statusCode).toBe(403);
    await deleteUser(other.userId);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/saved-views/${created.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });
});
