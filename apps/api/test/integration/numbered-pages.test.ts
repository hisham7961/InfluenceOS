import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ActivityDTO, CampaignSummaryDTO, CreatorTimelineItemDTO, CursorPage, Paginated, PublishedContentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P1.4 — numbered pages with a real total, newest first by when a post went
 * up, and no activity from brands outside a user's scope.
 */
describe('P1.4 — numbered pages and newest-first ordering', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const cleanupUsers: string[] = [];
  const brands: string[] = [];
  const tag = `NP${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload: payload as object });
  const get = async <T>(url: string, headers = auth) => (await app.inject({ method: 'GET', url: `/api/v1${url}`, headers })).json() as T;

  async function brand(name: string) {
    const id = idOf(await post('/brands', { name: `${tag} ${name}` }));
    brands.push(id);
    return id;
  }

  beforeAll(async () => {
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { brandId: { in: brands } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: brands } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brands } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    for (const id of [userId, ...cleanupUsers]) await deleteUser(id);
  });

  it('pages content by number with a total, newest post first even when it was added later', async () => {
    const b = await brand('Content');
    const c = idOf(await post('/campaigns', { brandId: b, name: `${tag} Content` }));
    const infl = idOf(await post('/influencers', { displayName: `${tag} Creator`, countryCode: 'KW' }));
    expect((await post(`/campaigns/${c}/influencers`, { influencerId: infl, dealType: 'FREE' })).statusCode).toBeLessThan(300);

    // Added in this order, published in a different one.
    const published = ['2026-03-10', '2026-03-20', '2026-03-01', '2026-03-15', '2026-03-05'];
    const ids: string[] = [];
    for (const [i, day] of published.entries()) {
      const res = await post('/content', {
        url: `https://www.snapchat.com/spotlight/${tag}p${i}`,
        campaignId: c,
        influencerId: infl,
        publishedAt: `${day}T12:00:00.000Z`,
      });
      expect(res.statusCode, res.body).toBe(201);
      ids.push(idOf(res));
    }
    // A post with no publish date sorts by when it was found (now) — first.
    const undated = await post('/content', { url: `https://www.snapchat.com/spotlight/${tag}undated`, campaignId: c, influencerId: infl });
    expect(undated.statusCode, undated.body).toBe(201);

    const page1 = await get<CursorPage<PublishedContentDTO>>(`/content/feed?brandId=${b}&page=1&limit=4`);
    expect(page1.pagination).toEqual({ page: 1, pageSize: 4, total: 6, totalPages: 2 });
    expect(page1.hasMore).toBe(true);
    expect(page1.data.map((x) => x.id)).toEqual([idOf(undated), ids[1], ids[3], ids[0]]);

    const page2 = await get<CursorPage<PublishedContentDTO>>(`/content/feed?brandId=${b}&page=2&limit=4`);
    expect(page2.data.map((x) => x.id)).toEqual([ids[4], ids[2]]);
    expect(page2.hasMore).toBe(false);

    // Changing the publish date re-sorts it (the database keeps the sort date in step).
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/content/${ids[2]}`, headers: auth, payload: { publishedAt: '2026-04-01T00:00:00.000Z' } })).statusCode).toBe(200);
    const resorted = await get<CursorPage<PublishedContentDTO>>(`/content/feed?brandId=${b}&page=1&limit=2`);
    expect(resorted.data.map((x) => x.id)).toEqual([idOf(undated), ids[2]]);

    // Cursor paging still works for clients that use it.
    const cursorPage = await get<CursorPage<PublishedContentDTO>>(`/content/feed?brandId=${b}&limit=4`);
    expect(cursorPage.pagination).toBeUndefined();
    expect(cursorPage.nextCursor).toBeTruthy();

    // The creator timeline pages by number too.
    const timeline = await get<CursorPage<CreatorTimelineItemDTO>>(`/influencers/${infl}/timeline?page=1&limit=3`);
    expect(timeline.pagination?.page).toBe(1);
    expect(timeline.pagination!.total).toBeGreaterThanOrEqual(timeline.data.length);
    expect(timeline.data.length).toBeLessThanOrEqual(3);
  });

  it('lists campaigns newest first', async () => {
    const b = await brand('Campaigns');
    const first = idOf(await post('/campaigns', { brandId: b, name: `${tag} First`, status: 'DRAFT' }));
    const second = idOf(await post('/campaigns', { brandId: b, name: `${tag} Second`, status: 'ACTIVE' }));
    const third = idOf(await post('/campaigns', { brandId: b, name: `${tag} Third`, status: 'DRAFT' }));
    const list = await get<Paginated<CampaignSummaryDTO>>(`/campaigns?brandId=${b}`);
    expect(list.data.map((x) => x.id)).toEqual([third, second, first]);
    const byName = await get<Paginated<CampaignSummaryDTO>>(`/campaigns?brandId=${b}&sort=name&order=asc`);
    expect(byName.data.map((x) => x.id)).toEqual([first, second, third]);
  });

  it("keeps other brands' activity out of a brand-limited user's feed", async () => {
    const mine = await brand('Act Mine');
    const theirs = await brand('Act Theirs');
    await post('/campaigns', { brandId: mine, name: `${tag} Act Mine` });
    await post('/campaigns', { brandId: theirs, name: `${tag} Act Theirs` });

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `np_${Date.now()}@example.test`;
    const staff = await prisma.user.create({ data: { email, name: 'NP Staff', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') } });
    await prisma.$disconnect();
    cleanupUsers.push(staff.id);
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.id}/brand-access`, headers: auth, payload: { brandIds: [mine] } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    const staffAuth = { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };

    const feed = await get<CursorPage<ActivityDTO>>('/activity?page=1&limit=50', staffAuth);
    const text = feed.data.map((a) => a.message).join('\n');
    expect(text).toContain(`${tag} Act Mine`);
    expect(text).not.toContain(`${tag} Act Theirs`);
    expect(feed.pagination?.total).toBeGreaterThan(0);
  });
});
