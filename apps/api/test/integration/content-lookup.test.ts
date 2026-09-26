import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ContentUrlLookupDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P1.5 — a pasted link says who posted it and which of their deliverables
 * it fulfils, and the same post reached through a different link is caught
 * as a repeat.
 */
describe('P1.5 — content link lookup and repeat detection', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const cleanupUsers: string[] = [];
  const brands: string[] = [];
  const influencers: string[] = [];
  const stamp = Date.now();
  const tag = `CL${stamp}`;
  // TikTok and X post ids are long digit strings; keep them unique per run.
  const tiktokId = `73${String(stamp).padStart(17, '0')}`;
  const tweetId = `18${String(stamp).padStart(17, '0')}`;
  const handle = `sara_${stamp}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const post = (url: string, payload: unknown, headers = auth) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload: payload as object });
  const lookup = async (url: string, headers = auth, campaignId?: string) => {
    const res = await post('/content/lookup', { url, ...(campaignId ? { campaignId } : {}) }, headers);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as ContentUrlLookupDTO;
  };

  let brandId: string;
  let campaignId: string;
  let influencerId: string;
  const deliverable: Record<string, string> = {};

  beforeAll(async () => {
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));

    brandId = idOf(await post('/brands', { name: `${tag} Brand` }));
    brands.push(brandId);
    campaignId = idOf(await post('/campaigns', { brandId, name: `${tag} Campaign`, status: 'ACTIVE' }));
    influencerId = idOf(await post('/influencers', { displayName: `${tag} Sara`, countryCode: 'KW' }));
    influencers.push(influencerId);
    const account = await post(`/influencers/${influencerId}/social-accounts`, { platform: 'TIKTOK', username: handle });
    expect(account.statusCode, account.body).toBeLessThan(300);
    const ci = await post(`/campaigns/${campaignId}/influencers`, { influencerId, dealType: 'FREE' });
    expect(ci.statusCode, ci.body).toBe(201);
    const ciId = idOf(ci);
    const add = async (key: string, body: object) => {
      const res = await post(`/campaign-influencers/${ciId}/deliverables`, body);
      expect(res.statusCode, res.body).toBe(201);
      deliverable[key] = idOf(res);
    };
    // The Instagram reel is due first, but a TikTok link should suggest the TikTok video first.
    await add('reel', { platform: 'INSTAGRAM', type: 'REEL', dueDate: '2026-10-01T00:00:00.000Z' });
    await add('video', { platform: 'TIKTOK', type: 'VIDEO', dueDate: '2026-10-05T00:00:00.000Z' });
    await add('ugc', { platform: 'TIKTOK', type: 'UGC', dueDate: '2026-09-30T00:00:00.000Z' });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent
      .deleteMany({ where: { OR: [{ brandId: { in: brands } }, { influencerId: { in: influencers } }, { externalId: { in: [tiktokId, tweetId] } }] } })
      .catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: brands } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brands } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: { in: influencers } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    for (const id of [userId, ...cleanupUsers]) await deleteUser(id);
  });

  it('names the creator from the handle in the link and suggests their open deliverables, this platform first', async () => {
    const res = await lookup(`https://www.tiktok.com/@${handle.toUpperCase()}/video/${tiktokId}?is_from_webapp=1&sender_device=pc`);
    expect(res.platform).toBe('TIKTOK');
    expect(res.canonicalUrl).toBe(`https://www.tiktok.com/@${handle.toUpperCase()}/video/${tiktokId}`);
    expect(res.handle).toBe(handle.toUpperCase());
    expect(res.existing).toBeNull();
    expect(res.influencer?.id).toBe(influencerId);
    // UGC is never posted, so it isn't offered.
    expect(res.openDeliverables.map((d) => d.deliverableId)).toEqual([deliverable.video, deliverable.reel]);
    expect(res.openDeliverables[0]).toMatchObject({ campaignId, campaignName: `${tag} Campaign`, brandName: `${tag} Brand`, type: 'VIDEO', platform: 'TIKTOK' });

    // A campaign's own Add Content only suggests that campaign's deliverables.
    const otherCampaign = idOf(await post('/campaigns', { brandId, name: `${tag} Other`, status: 'ACTIVE' }));
    const scoped = await lookup(`https://www.tiktok.com/@${handle}/video/${tiktokId}`, auth, otherCampaign);
    expect(scoped.influencer?.id).toBe(influencerId);
    expect(scoped.openDeliverables).toEqual([]);
  });

  it('says nothing about links from unsupported sites or links without a handle', async () => {
    const unsupported = await lookup('https://example.com/some/video');
    expect(unsupported).toMatchObject({ canonicalUrl: null, platform: null, handle: null, influencer: null, openDeliverables: [] });

    const noHandle = await lookup('https://www.instagram.com/reel/C1abcDEFg/');
    expect(noHandle.platform).toBe('INSTAGRAM');
    expect(noHandle.handle).toBeNull();
    expect(noHandle.influencer).toBeNull();
  });

  it('catches the same post added through a different link', async () => {
    const created = await post('/content', { url: `https://www.tiktok.com/@${handle}/video/${tiktokId}`, deliverableId: deliverable.video });
    expect(created.statusCode, created.body).toBe(201);
    const contentId = idOf(created);

    // Linked to the deliverable, so it's no longer suggested.
    const again = await lookup(`https://www.tiktok.com/@${handle}/video/${tiktokId}`);
    expect(again.existing).toEqual({ id: contentId });
    expect(again.openDeliverables.map((d) => d.deliverableId)).toEqual([deliverable.reel]);

    // Same video id under another path is the same post.
    const otherPath = await lookup(`https://www.tiktok.com/@someone_else/video/${tiktokId}`);
    expect(otherPath.existing).toEqual({ id: contentId });
    const dup = await post('/content', { url: `https://www.tiktok.com/@someone_else/video/${tiktokId}` });
    expect(dup.statusCode).toBe(409);

    // twitter.com and x.com links to one tweet are one post.
    const tweet = await post('/content', { url: `https://twitter.com/${handle}/status/${tweetId}`, brandId });
    expect(tweet.statusCode, tweet.body).toBe(201);
    const xDup = await post('/content', { url: `https://x.com/${handle}/status/${tweetId}` });
    expect(xDup.statusCode).toBe(409);
  });

  it("hides another brand's post and deliverables from a brand-limited user", async () => {
    const otherBrand = idOf(await post('/brands', { name: `${tag} Elsewhere` }));
    brands.push(otherBrand);

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `cl_${stamp}@example.test`;
    const staff = await prisma.user.create({ data: { email, name: 'CL Staff', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') } });
    await prisma.$disconnect();
    cleanupUsers.push(staff.id);
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.id}/brand-access`, headers: auth, payload: { brandIds: [otherBrand] } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    const staffAuth = { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };

    const res = await lookup(`https://www.tiktok.com/@${handle}/video/${tiktokId}`, staffAuth);
    // It exists, but not which row it is.
    expect(res.existing).toEqual({ id: null });
    // The creator isn't brand-owned, but their campaign with the other brand is.
    expect(res.influencer?.id).toBe(influencerId);
    expect(res.openDeliverables).toEqual([]);
  });

  it("links the roster's campaign-less posts to the campaign, and leaves other campaigns' posts alone", async () => {
    const yt = (c: string) => `https://www.youtube.com/watch?v=${c}${String(stamp).slice(-10)}`;
    const free = await post('/content', { url: yt('A'), influencerId });
    expect(free.statusCode, free.body).toBe(201);

    const elsewhere = idOf(await post('/campaigns', { brandId, name: `${tag} Elsewhere campaign`, status: 'ACTIVE' }));
    expect((await post(`/campaigns/${elsewhere}/influencers`, { influencerId, dealType: 'FREE' })).statusCode).toBe(201);
    const inOther = await post('/content', { url: yt('B'), influencerId, campaignId: elsewhere });
    expect(inOther.statusCode, inOther.body).toBe(201);

    const foreignBrand = idOf(await post('/brands', { name: `${tag} Foreign` }));
    brands.push(foreignBrand);
    const otherBrandPost = await post('/content', { url: yt('C'), influencerId, brandId: foreignBrand });
    expect(otherBrandPost.statusCode, otherBrandPost.body).toBe(201);

    const res = await post(`/campaigns/${campaignId}/content/link-roster`, undefined);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ linked: 1, skipped: 0 });

    const campaignOf = async (id: string) =>
      ((await app.inject({ method: 'GET', url: `/api/v1/content/${id}`, headers: auth })).json() as { campaign: { id: string } | null }).campaign?.id ?? null;
    expect(await campaignOf(idOf(free))).toBe(campaignId);
    expect(await campaignOf(idOf(inOther))).toBe(elsewhere);
    expect(await campaignOf(idOf(otherBrandPost))).toBeNull();

    // Running it again finds nothing new.
    expect((await post(`/campaigns/${campaignId}/content/link-roster`, undefined)).json()).toEqual({ linked: 0, skipped: 0 });
  });
});
