import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CostSummaryDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W1-7 (finance P1) — a PARTIALLY_PAID fee must record how much was paid and
 * report only the remainder as unpaid. Before this fix, progress.ts bucketed the
 * WHOLE fee into `unpaid`, so a 1,500-of-3,000 fee wrongly reported 3,000 unpaid.
 */
describe('finance — partial payment splits paid/unpaid correctly', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let influencerId: string;
  let campaignId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    adminId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Pay Brand ${Date.now()}` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Pay Inf ${Date.now()}`, countryCode: 'KW' } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Pay Camp ${Date.now()}`, currency: 'KWD' } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaignInfluencer.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  async function summary(): Promise<CostSummaryDTO> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: auth });
    expect(res.statusCode).toBe(200);
    return (res.json() as { summary: CostSummaryDTO }).summary;
  }

  async function addFee(payload: Record<string, unknown>): Promise<string> {
    const res = await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId, dealType: 'PAID', currency: 'KWD', ...payload } });
    expect(res.statusCode).toBe(201);
    return idOf(res);
  }

  it('a 1,500-of-3,000 partial payment reports 1,500 paid + 1,500 unpaid (not 3,000 unpaid)', async () => {
    const ciId = await addFee({ agreedCost: 3000, paymentStatus: 'PARTIALLY_PAID', paidAmount: 1500 });
    const s = await summary();
    expect(s.influencerFees).toBe(3000);
    expect(s.paid).toBe(1500);
    expect(s.unpaid).toBe(1500);

    // Marking it fully PAID moves the whole fee to paid.
    await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth, payload: { paymentStatus: 'PAID' } });
    const paidSummary = await summary();
    expect(paidSummary.paid).toBe(3000);
    expect(paidSummary.unpaid).toBe(0);

    // Reverting to UNPAID moves it all back to unpaid.
    await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth, payload: { paymentStatus: 'UNPAID' } });
    const unpaidSummary = await summary();
    expect(unpaidSummary.paid).toBe(0);
    expect(unpaidSummary.unpaid).toBe(3000);
  });

  it('a partial payment with no recorded paidAmount counts as 0 paid (not the whole fee)', async () => {
    // Clear the previous fee first so this assertion is isolated.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaignInfluencer.deleteMany({ where: { campaignId } });
    await prisma.$disconnect();

    await addFee({ agreedCost: 2000, paymentStatus: 'PARTIALLY_PAID' }); // no paidAmount
    const s = await summary();
    expect(s.paid).toBe(0);
    expect(s.unpaid).toBe(2000);
  });
});
