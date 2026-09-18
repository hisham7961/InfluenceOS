import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignDetailDTO, CampaignSummaryDTO, Paginated } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W7-1 (PERF-01) — the campaign LIST computes progress in a fixed number of
 * batched queries instead of a per-campaign fan-out. This proves the batched
 * numbers are byte-for-byte identical to the per-campaign detail computation,
 * across deliverables, participation and mixed paid/free/partial money.
 */
describe('W7-1 — batched campaign-list progress equals per-campaign detail', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Batch Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Batch Camp ${Date.now()}`, plannedBudget: 1000, currency: 'KWD' } }));

    const infA = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Batch A ${Date.now()}` } }));
    const infB = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Batch B ${Date.now()}` } }));

    // A PAID, partially-paid participation (exercises the money split) marked COMPLETED.
    const ciA = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: infA, dealType: 'PAID', agreedCost: 300, currency: 'KWD', paymentStatus: 'PARTIALLY_PAID', paidAmount: 100 } }));
    await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciA}`, headers: auth, payload: { participationStatus: 'COMPLETED' } });
    // A FREE participation.
    const ciB = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: infB, dealType: 'FREE' } }));

    // Deliverables: one published, one planned, across the two participations.
    const d1 = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciA}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'REEL' } }));
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${d1}`, headers: auth, payload: { status: 'PUBLISHED' } });
    await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciB}/deliverables`, headers: auth, payload: { platform: 'TIKTOK', type: 'VIDEO' } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: 'Batch ' } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('list progress matches detail progress on the stable fields', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns?brandId=${brandId}&pageSize=50`, headers: auth })).json() as Paginated<CampaignSummaryDTO>;
    const fromList = list.data.find((c) => c.id === campaignId)!.progress;
    const fromDetail = ((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}`, headers: auth })).json() as CampaignDetailDTO).progress;

    for (const key of ['deliverablesTotal', 'deliverablesPublished', 'deliverableCompletion', 'influencersTotal', 'influencersCompleted', 'spend', 'plannedBudget', 'budgetUsedPercent'] as const) {
      expect(fromList[key], `progress.${key}`).toEqual(fromDetail[key]);
    }

    // Sanity: the known fixture values.
    expect(fromList.deliverablesTotal).toBe(2);
    expect(fromList.deliverablesPublished).toBe(1);
    expect(fromList.deliverableCompletion).toBe(50);
    expect(fromList.influencersTotal).toBe(2);
    expect(fromList.influencersCompleted).toBe(1);
    expect(fromList.spend).toBe(300); // only the PAID fee counts as spend (FREE = 0)
  });
});
