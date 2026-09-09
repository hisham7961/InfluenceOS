import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * End-to-end money precision (freeze pass item 2). Drives real money through the
 * full stack — API → domain → Decimal(18,3) storage → cost summary DTO — using
 * amounts that naive floating-point arithmetic gets wrong, and asserts the
 * totals are exact. Complements the pure unit test in
 * packages/domain/src/lib/__tests__/money.test.ts.
 */
describe('money precision — exact totals through the whole stack', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let campaignId: string;

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    auth = admin.auth;
    adminId = admin.userId;

    const brand = await app.inject({
      method: 'POST',
      url: '/api/v1/brands',
      headers: auth,
      payload: { name: `Money Precision ${Date.now()}` },
    });
    brandId = (brand.json() as { id: string }).id;

    const campaign = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: auth,
      payload: { brandId, name: `Precision Campaign ${Date.now()}`, currency: 'KWD', plannedBudget: 1000 },
    });
    campaignId = (campaign.json() as { id: string }).id;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    if (campaignId) {
      await prisma.campaignExpense.deleteMany({ where: { campaignId } }).catch(() => undefined);
      await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
    }
    if (brandId) await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  it('sums many fils-precise, float-hostile expense lines to an exact total', async () => {
    // Non-gift expenses: 0.1+0.2+12.345+0.005+0.055+7.495+100.1 = 120.300 exactly.
    // (KWD carries 3 decimals — the 0.005 / 0.055 lines would truncate at scale 2.)
    const amounts = [0.1, 0.2, 12.345, 0.005, 0.055, 7.495, 100.1];
    for (const amount of amounts) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/expenses`,
        headers: auth,
        payload: { type: 'PRODUCTION', amount, currency: 'KWD', paymentStatus: 'PAID' },
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    // A GIFT_PRODUCT expense must land in giftValue, never in cash spend.
    const gift = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/expenses`,
      headers: auth,
      payload: { type: 'GIFT_PRODUCT', amount: 50, currency: 'KWD', paymentStatus: 'NOT_APPLICABLE' },
    });
    expect(gift.statusCode).toBe(201);

    const costs = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: auth });
    expect(costs.statusCode).toBe(200);
    const { summary } = costs.json() as {
      summary: {
        totalSpend: number;
        otherExpenses: number;
        giftValue: number;
        paid: number;
        budgetUsedPercent: number | null;
      };
    };

    // Exact — not 120.30000000000001.
    expect(summary.otherExpenses).toBe(120.3);
    expect(summary.totalSpend).toBe(120.3);
    expect(summary.paid).toBe(120.3);
    // Gift value is separate cash-free spend.
    expect(summary.giftValue).toBe(50);
    // round(120.3 / 1000 * 100) = 12.
    expect(summary.budgetUsedPercent).toBe(12);
  });

  it('preserves 3-decimal (fils) amounts through storage', async () => {
    const costs = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: auth });
    const { expenses } = costs.json() as { expenses: Array<{ amount: number }> };
    // The 0.005 and 0.055 lines survive round-trip at scale 3.
    expect(expenses.some((e) => e.amount === 0.005)).toBe(true);
    expect(expenses.some((e) => e.amount === 0.055)).toBe(true);
  });
});
