import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignInfluencerDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Roster tab follow-up: newest-added influencer must surface first (not get
 * buried at the bottom), and each roster row must carry enough to show a
 * per-influencer content-linked status + all-time campaign-participation
 * count without any N+1 (GET /campaigns/:id/influencers stays a few queries
 * total regardless of roster size).
 */
describe('Campaign roster — newest-first order + contentCount/allTimeCampaignCount', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignA: string;
  let campaignB: string;
  let first: string;
  let second: string;
  let third: string;

  const tag = `RO-${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `${tag} Brand` } }));
    campaignA = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `${tag} Camp A` } }));
    campaignB = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `${tag} Camp B` } }));

    first = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${tag} First`, countryCode: 'KW' } }));
    second = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${tag} Second`, countryCode: 'KW' } }));
    third = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${tag} Third`, countryCode: 'KW' } }));

    // Added in this order — API call order is the createdAt order.
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: auth, payload: { influencerId: first, dealType: 'FREE' } });
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: auth, payload: { influencerId: second, dealType: 'FREE' } });
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: auth, payload: { influencerId: third, dealType: 'FREE' } });

    // `second` has two videos linked to campaign A.
    await app.inject({
      method: 'POST', url: '/api/v1/content', headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}V1`, campaignId: campaignA, influencerId: second },
    });
    await app.inject({
      method: 'POST', url: '/api/v1/content', headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}V2`, campaignId: campaignA, influencerId: second },
    });

    // `second` is also on campaign B — an all-time count of 2, one of which is campaign A.
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignB}/influencers`, headers: auth, payload: { influencerId: second, dealType: 'FREE' } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    for (const id of [first, second, third]) await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('lists the roster newest-added first', async () => {
    const res = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: auth })
    ).json() as CampaignInfluencerDTO[];
    expect(res.map((r) => r.influencer.id)).toEqual([third, second, first]);
  });

  it('reports contentCount scoped to THIS campaign, and allTimeCampaignCount across all campaigns', async () => {
    const res = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: auth })
    ).json() as CampaignInfluencerDTO[];
    const secondRow = res.find((r) => r.influencer.id === second)!;
    const firstRow = res.find((r) => r.influencer.id === first)!;
    expect(secondRow.contentCount).toBe(2);
    expect(secondRow.allTimeCampaignCount).toBe(2); // campaign A + campaign B
    expect(firstRow.contentCount).toBe(0);
    expect(firstRow.allTimeCampaignCount).toBe(1); // campaign A only
  });
});
