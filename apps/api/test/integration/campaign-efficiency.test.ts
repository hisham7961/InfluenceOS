import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignEfficiencyDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W6-1 (ARCH-01) — campaign spend-efficiency is computed SERVER-SIDE. The
 * browser used to derive CPV/CPM/CPE from the content feed; now the API returns
 * them (plus metric freshness + provenance) and the client only renders. This
 * proves the server math against known fixture metrics.
 */
describe('W6-1 — server-computed campaign efficiency', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let contentA: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const stamp = Date.now();
  const videoId = (n: number) => (stamp.toString(36) + n + 'zzzzzzzzzzz').slice(0, 11);

  async function addContent(vid: string, metrics: Record<string, number>): Promise<string> {
    const id = idOf(await app.inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url: `https://www.youtube.com/watch?v=${vid}`, campaignId } }));
    await app.inject({ method: 'POST', url: `/api/v1/content/${id}/metrics`, headers: auth, payload: metrics });
    return id;
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Eff Brand ${stamp}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Eff Camp ${stamp}`, plannedBudget: 1000, currency: 'KWD' } }));
    const inf = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Eff Inf ${stamp}`, countryCode: 'KW' } }));
    // One PAID fee of 500 → campaign spend is exactly 500.
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: inf, dealType: 'PAID', agreedCost: 500, currency: 'KWD', paymentStatus: 'PAID' } });

    // Two measured content pieces: totalViews 1000, totalEngagement 250.
    contentA = await addContent(videoId(1), { views: 600, likes: 100 }); // engagement 100
    await addContent(videoId(2), { views: 400, likes: 100, comments: 50 }); // engagement 150
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: 'Eff Inf ' } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('computes CPV, CPM, CPE, rollups, freshness and provenance server-side', async () => {
    const eff = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/efficiency`, headers: auth })).json() as CampaignEfficiencyDTO;

    expect(eff.currency).toBe('KWD');
    expect(eff.totalSpend).toBe(500);
    expect(eff.contentCount).toBe(2);
    expect(eff.contentWithMetrics).toBe(2);
    expect(eff.totalViews).toBe(1000);
    expect(eff.totalEngagement).toBe(250);
    expect(eff.costPerView).toBe(0.5); // 500 / 1000
    expect(eff.costPerMille).toBe(500); // CPV × 1000
    expect(eff.costPerEngagement).toBe(2); // 500 / 250
    expect(eff.costPerContent).toBe(250); // 500 / 2

    // Just-synced manual metrics → fresh, all from MANUAL.
    expect(eff.isStale).toBe(false);
    expect(eff.freshnessWindowDays).toBe(7);
    expect(typeof eff.metricsLastSyncedAt).toBe('string');
    expect(eff.sources).toEqual([{ source: 'MANUAL', count: 2 }]);

    // Per-content rows carry server-computed numbers.
    expect(eff.perContent).toHaveLength(2);
    const a = eff.perContent.find((p) => p.contentId === contentA)!;
    expect(a.views).toBe(600);
    expect(a.totalEngagement).toBe(100);
    expect(a.costPerView).toBeCloseTo(250 / 600, 6); // est. CPV = cost-per-content ÷ views
    expect(a.source).toBe('MANUAL');
  });

  it('404s for an unknown campaign', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns/does-not-exist/efficiency', headers: auth });
    expect(res.statusCode).toBe(404);
  });
});
