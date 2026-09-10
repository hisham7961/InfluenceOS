import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Collaboration money semantics (freeze pass item 6). Locks how each deal type
 * feeds the cost summary now that money is exact Decimal:
 *   PAID / PAID_PLUS_GIFTED → influencer fees (cash spend)
 *   FREE                    → exact 0 fee, still counted as a collaboration
 *   GIFTED_PRODUCT          → gifted value only, never cash spend; cost is null
 * A FREE deal's agreedCost is an explicit 0 (not missing); a gifted-only deal's
 * agreedCost is null (missing, not 0).
 */
describe('deal money semantics — PAID / FREE / GIFTED / PAID_PLUS_GIFTED', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let campaignId: string;

  async function post(url: string, payload: unknown) {
    return app.inject({ method: 'POST', url, headers: auth, payload });
  }

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    auth = admin.auth;
    adminId = admin.userId;
    brandId = ((await post('/api/v1/brands', { name: `Deals ${Date.now()}` })).json() as { id: string }).id;
    campaignId = (
      (await post('/api/v1/campaigns', { brandId, name: `Deals Campaign ${Date.now()}`, currency: 'KWD' })).json() as {
        id: string;
      }
    ).id;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    if (campaignId) {
      await prisma.campaignInfluencer.deleteMany({ where: { campaignId } }).catch(() => undefined);
      await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
    }
    if (brandId) await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  async function makeInfluencer(name: string): Promise<string> {
    const res = await post('/api/v1/influencers', { displayName: name });
    return (res.json() as { id: string }).id;
  }

  it('feeds the cost summary correctly per deal type', async () => {
    const [paid, free, gifted, combo] = await Promise.all([
      makeInfluencer(`Paid ${Date.now()}`),
      makeInfluencer(`Free ${Date.now()}`),
      makeInfluencer(`Gift ${Date.now()}`),
      makeInfluencer(`Combo ${Date.now()}`),
    ]);

    await post(`/api/v1/campaigns/${campaignId}/influencers`, {
      influencerId: paid,
      dealType: 'PAID',
      agreedCost: 100,
      paymentStatus: 'PAID',
    });
    await post(`/api/v1/campaigns/${campaignId}/influencers`, {
      influencerId: free,
      dealType: 'FREE',
      agreedCost: 0,
      paymentStatus: 'NOT_APPLICABLE',
    });
    await post(`/api/v1/campaigns/${campaignId}/influencers`, {
      influencerId: gifted,
      dealType: 'GIFTED_PRODUCT',
      giftedProductValue: 50,
      paymentStatus: 'NOT_APPLICABLE',
    });
    await post(`/api/v1/campaigns/${campaignId}/influencers`, {
      influencerId: combo,
      dealType: 'PAID_PLUS_GIFTED',
      agreedCost: 200,
      giftedProductValue: 30,
      paymentStatus: 'PAID',
    });

    const costs = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: auth });
    const { summary } = costs.json() as {
      summary: { influencerFees: number; giftValue: number; paid: number; totalSpend: number };
    };
    expect(summary.influencerFees).toBe(300); // 100 (PAID) + 200 (PAID_PLUS_GIFTED); FREE adds 0
    expect(summary.giftValue).toBe(80); // 50 + 30 — gifted value, never cash
    expect(summary.paid).toBe(300);
    expect(summary.totalSpend).toBe(300); // gifts are not cash spend
  });

  it('keeps FREE as an exact 0 fee and gifted-only as a missing (null) fee', async () => {
    const list = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })
    ).json() as Array<{ dealType: string; agreedCost: number | null; giftedProductValue: number | null }>;

    const free = list.find((c) => c.dealType === 'FREE');
    const gifted = list.find((c) => c.dealType === 'GIFTED_PRODUCT');
    expect(free?.agreedCost).toBe(0); // exact zero, not null
    expect(gifted?.agreedCost).toBeNull(); // missing, not 0
    expect(gifted?.giftedProductValue).toBe(50);
  });
});
