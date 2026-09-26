import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignEfficiencyDTO, CampaignInfluencerDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P1.6 — each creator's results on a campaign: their posts (up vs planned),
 * their latest numbers, and their own cost. The 3,000 KWD creator and the
 * 100 KWD one no longer share one averaged cost per view.
 */
describe('P1.6 — per-creator results on the roster and the Performance tab', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  const stamp = Date.now();
  const tag = `CR${stamp}`;
  const influencers: string[] = [];
  const roster: Record<'star' | 'budget' | 'gifted', string> = { star: '', budget: '', gifted: '' };
  const creator: Record<'star' | 'budget' | 'gifted', string> = { star: '', budget: '', gifted: '' };
  const posts: Record<string, string> = {};

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const post = async (url: string, payload: object) => {
    const res = await app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth, payload });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res;
  };
  const videoId = (n: number) => (stamp.toString(36) + 'cr' + n + 'zzzzzzzzzzz').slice(0, 11);
  async function addPost(key: string, influencerId: string | null, metrics: Record<string, number>) {
    const res = await post('/content', {
      url: `https://www.youtube.com/watch?v=${videoId(Object.keys(posts).length + 1)}`,
      campaignId,
      ...(influencerId ? { influencerId } : {}),
    });
    posts[key] = idOf(res);
    await post(`/content/${posts[key]}/metrics`, metrics);
  }

  beforeAll(async () => {
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));

    brandId = idOf(await post('/brands', { name: `${tag} Brand` }));
    campaignId = idOf(await post('/campaigns', { brandId, name: `${tag} Campaign`, currency: 'KWD', status: 'ACTIVE' }));

    const join = async (key: 'star' | 'budget' | 'gifted', body: object) => {
      creator[key] = idOf(await post('/influencers', { displayName: `${tag} ${key}`, countryCode: 'KW' }));
      influencers.push(creator[key]);
      roster[key] = idOf(await post(`/campaigns/${campaignId}/influencers`, { influencerId: creator[key], ...body }));
    };
    await join('star', { dealType: 'PAID', agreedCost: 3000, currency: 'KWD', paymentStatus: 'UNPAID' });
    await join('budget', { dealType: 'PAID', agreedCost: 100, currency: 'KWD', paymentStatus: 'PAID' });
    await join('gifted', { dealType: 'GIFTED_PRODUCT', giftedProductValue: 80, currency: 'KWD' });

    // Planned posts: 2 reels + 1 cancelled story + 1 UGC video (never posted) → 2.
    await post(`/campaign-influencers/${roster.star}/deliverables`, { platform: 'INSTAGRAM', type: 'REEL', quantity: 2 });
    await post(`/campaign-influencers/${roster.star}/deliverables`, { platform: 'INSTAGRAM', type: 'STORY', status: 'CANCELLED' });
    await post(`/campaign-influencers/${roster.star}/deliverables`, { platform: 'TIKTOK', type: 'UGC' });
    await post(`/campaign-influencers/${roster.gifted}/deliverables`, { platform: 'TIKTOK', type: 'VIDEO' });

    // Star: a 200 KWD production cost counts; the 999 KWD gift purchase doesn't.
    await post(`/campaigns/${campaignId}/expenses`, { type: 'PRODUCTION', amount: 200, currency: 'KWD', campaignInfluencerId: roster.star });
    await post(`/campaigns/${campaignId}/expenses`, { type: 'GIFT_PRODUCT', amount: 999, currency: 'KWD', campaignInfluencerId: roster.star });
    // A campaign-wide cost, tied to no one.
    await post(`/campaigns/${campaignId}/expenses`, { type: 'OTHER', amount: 300, currency: 'KWD' });

    await addPost('star1', creator.star, { views: 10000, likes: 400, comments: 100 }); // 500 engagements
    await addPost('star2', creator.star, { views: 20000, likes: 900, shares: 100 }); // 1,000 engagements
    await addPost('budget1', creator.budget, { views: 50000, likes: 2000 });
    await addPost('orphan', null, { views: 1000, likes: 10 });

    // The star's second post was taken down later: still counted, no longer live.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.update({ where: { id: posts.star2! }, data: { availabilityStatus: 'REMOVED' } });
    await prisma.$disconnect();
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: { in: influencers } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it("gives each roster row that creator's own posts, numbers and cost", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as CampaignInfluencerDTO[] | { data: CampaignInfluencerDTO[] };
    const rows = Array.isArray(body) ? body : body.data;
    const row = (key: 'star' | 'budget' | 'gifted') => rows.find((r) => r.id === roster[key])!.results;

    const star = row('star');
    expect(star).toMatchObject({ postsTotal: 2, postsLive: 1, postsPlanned: 2, postsWithMetrics: 2, views: 30000, engagements: 1500 });
    expect(star.spend).toBe(3200); // fee 3,000 + production 200; the gift purchase isn't spend
    expect(star.costPerView).toBeCloseTo(3200 / 30000, 8);
    expect(star.costPerEngagement).toBeCloseTo(3200 / 1500, 8);
    expect(star.engagementRate).toBeCloseTo(5, 8); // 1,500 / 30,000

    const budget = row('budget');
    expect(budget).toMatchObject({ postsTotal: 1, postsLive: 1, postsPlanned: 0, views: 50000, engagements: 2000, spend: 100 });
    expect(budget.costPerView).toBeCloseTo(0.002, 8);

    // Gifted, nothing posted yet: no spend, nothing to divide.
    expect(row('gifted')).toMatchObject({
      postsTotal: 0,
      postsLive: 0,
      postsPlanned: 1,
      postsWithMetrics: 0,
      views: null,
      engagements: null,
      engagementRate: null,
      spend: 0,
      costPerView: null,
      costPerEngagement: null,
    });
  });

  it('compares creators on the Performance tab and prices each post from its own creator', async () => {
    const eff = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/efficiency`, headers: auth })).json() as CampaignEfficiencyDTO;

    // Campaign total is unchanged by the split: 3,000 + 100 + 200 + 300.
    expect(eff.totalSpend).toBe(3600);

    expect(eff.perCreator.map((c) => c.campaignInfluencerId).sort()).toEqual(Object.values(roster).sort());
    const star = eff.perCreator.find((c) => c.campaignInfluencerId === roster.star)!;
    expect(star).toMatchObject({ influencerId: creator.star, influencerName: `${tag} star`, spend: 3200, views: 30000 });
    const budget = eff.perCreator.find((c) => c.campaignInfluencerId === roster.budget)!;
    expect(budget.costPerView!).toBeLessThan(star.costPerView!);

    const cpv = (key: string) => eff.perContent.find((p) => p.contentId === posts[key])!.costPerView;
    expect(cpv('star1')).toBeCloseTo(3200 / 2 / 10000, 8); // half the star's spend over this post's views
    expect(cpv('star2')).toBeCloseTo(3200 / 2 / 20000, 8);
    expect(cpv('budget1')).toBeCloseTo(100 / 50000, 8);
    expect(cpv('orphan')).toBeCloseTo(300 / 1000, 8); // the campaign-wide cost, over the one post with no creator
  });
});
