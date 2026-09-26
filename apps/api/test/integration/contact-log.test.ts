import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreatorSnapshotDTO, CreatorTimelineItemDTO, InfluencerDetailDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P1.3 — messages sent from the WhatsApp templates are logged: who was
 * contacted, when and why, in the creator's timeline and "last contact".
 */
describe('P1.3 — creator contact log', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const cleanupUsers: string[] = [];
  const brands: string[] = [];
  const tag = `CL${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload: payload as object });
  const get = async <T>(url: string, headers = auth) => (await app.inject({ method: 'GET', url: `/api/v1${url}`, headers })).json() as T;

  async function brand(name: string) {
    const id = idOf(await post('/brands', { name: `${tag} ${name}` }));
    brands.push(id);
    return id;
  }
  async function campaign(brandId: string, name: string) {
    return idOf(await post('/campaigns', { brandId, name: `${tag} ${name}` }));
  }
  async function creator(name: string) {
    return idOf(await post('/influencers', { displayName: `${tag} ${name}`, countryCode: 'KW', whatsapp: '99887766' }));
  }
  async function roster(campaignId: string, influencerId: string) {
    const res = await post(`/campaigns/${campaignId}/influencers`, { influencerId, dealType: 'FREE' });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return idOf(res);
  }
  async function userWith(role: 'STAFF' | 'VIEWER', brandIds?: string[]) {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `cl_${role.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`;
    const user = await prisma.user.create({ data: { email, name: `CL ${role}`, role, passwordHash: await hash('Str0ng-Passw0rd!') } });
    await prisma.$disconnect();
    cleanupUsers.push(user.id);
    if (brandIds) await app.inject({ method: 'PUT', url: `/api/v1/users/${user.id}/brand-access`, headers: auth, payload: { brandIds } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    return { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };
  }

  beforeAll(async () => {
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: brands } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brands } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    for (const id of [userId, ...cleanupUsers]) await deleteUser(id);
  });

  it('logs a WhatsApp message, marks the roster row contacted and shows it as the last contact', async () => {
    const b = await brand('Main');
    const c = await campaign(b, 'Main');
    const infl = await creator('Main');
    const ci = await roster(c, infl);

    const res = await post(`/influencers/${infl}/contact-log`, { channel: 'WHATSAPP', purpose: 'BRIEF', campaignInfluencerId: ci });
    expect(res.statusCode, res.body).toBe(204);

    const rows = await get<{ id: string; dateContacted: string | null }[]>(`/campaigns/${c}/influencers`);
    expect(rows.find((r) => r.id === ci)?.dateContacted).toBeTruthy();

    const snapshot = await get<CreatorSnapshotDTO>(`/influencers/${infl}/snapshot`);
    expect(snapshot.lastContactAt).toBeTruthy();

    const timeline = await get<{ data: CreatorTimelineItemDTO[] }>(`/influencers/${infl}/timeline`);
    const logged = timeline.data.find((i) => i.bucket === 'collaboration' && i.message.includes('on WhatsApp'));
    expect(logged?.message).toContain(`${tag} Main`);

    // A message not tied to a campaign is logged too.
    expect((await post(`/influencers/${infl}/contact-log`, { purpose: 'GENERAL' })).statusCode).toBe(204);
  });

  it('refuses a roster row of another creator, an unknown purpose, and read-only users', async () => {
    const b = await brand('Checks');
    const c = await campaign(b, 'Checks');
    const one = await creator('One');
    const other = await creator('Other');
    const otherCi = await roster(c, other);
    await roster(c, one);

    expect((await post(`/influencers/${one}/contact-log`, { campaignInfluencerId: otherCi })).statusCode).toBe(404);
    expect((await post(`/influencers/${one}/contact-log`, { purpose: 'SPAM' })).statusCode).toBe(422);

    const viewer = await userWith('VIEWER');
    expect((await post(`/influencers/${one}/contact-log`, { purpose: 'GENERAL' }, viewer)).statusCode).toBe(403);
  });

  it("keeps a brand-scoped user out of other brands' campaigns with the same creator", async () => {
    const mine = await brand('Scope Mine');
    const theirs = await brand('Scope Theirs');
    const cMine = await campaign(mine, 'Scope Mine');
    const cTheirs = await campaign(theirs, 'Scope Theirs');
    const shared = await creator('Shared');
    await roster(cMine, shared);
    const theirCi = await roster(cTheirs, shared);

    const staff = await userWith('STAFF', [mine]);
    expect((await post(`/influencers/${shared}/contact-log`, { campaignInfluencerId: theirCi }, staff)).statusCode).toBe(404);

    // The creator's history shows only the campaigns the user may see.
    const asStaff = await get<InfluencerDetailDTO>(`/influencers/${shared}`, staff);
    expect(asStaff.history.campaignCount).toBe(1);
    expect(asStaff.history.brandsWorkedWith.map((x) => x.id)).toEqual([mine]);
    const asAdmin = await get<InfluencerDetailDTO>(`/influencers/${shared}`);
    expect(asAdmin.history.campaignCount).toBe(2);
  });
});
