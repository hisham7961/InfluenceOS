import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ExecDashboardDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W6-3 — server-computed executive overview. Answers the five exec questions the
 * weekly dashboard could not: spend **vs budget** (+ per-campaign over-budget),
 * what happened **today**, what changed **since yesterday**, and **which brands**
 * have issues (cross-brand rollup). All numbers are computed server-side.
 *
 * The assertions query with an explicit `brandId` so the whole overview is
 * scoped to this test's fixture brand — deterministic regardless of other data.
 */
describe('W6-3 — executive dashboard rollups', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  // A due time later *today* (in the today window, but strictly in the future so
  // it is not also counted as overdue). Robust except the last minute of a UTC day.
  const now = new Date();
  const startOfTodayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endOfTodayMs = startOfTodayMs + 864e5;
  const dueLaterToday = new Date(Math.min(now.getTime() + 3_600_000, endOfTodayMs - 60_000)).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 2 * 864e5).toISOString();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Exec Brand ${Date.now()}` } }));
    const inf1 = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Exec A ${Date.now()}` } }));
    const inf2 = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Exec B ${Date.now()}` } }));

    // C1 — ACTIVE, budget 1000, starts and ends today, one PAID fee of 300.
    const c1 = idOf(await app.inject({
      method: 'POST', url: '/api/v1/campaigns', headers: auth,
      payload: { brandId, name: `Exec C1 ${Date.now()}`, plannedBudget: 1000, currency: 'KWD', status: 'ACTIVE', startDate: now.toISOString(), endDate: now.toISOString() },
    }));
    const ci1 = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${c1}/influencers`, headers: auth, payload: { influencerId: inf1, dealType: 'PAID', agreedCost: 300, currency: 'KWD', paymentStatus: 'PAID' } }));
    // A published deliverable (completed "since yesterday").
    const d1 = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ci1}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'REEL' } }));
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${d1}`, headers: auth, payload: { status: 'PUBLISHED' } });
    // An open deliverable due later today (counts as due-today, not overdue).
    await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ci1}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'STORY', dueDate: dueLaterToday } });
    // An open deliverable that is overdue (a brand-health issue).
    await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ci1}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'POST', dueDate: twoDaysAgo } });

    // C2 — DRAFT, budget 100, a PAID fee of 500 → this campaign is over its budget.
    const c2 = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Exec C2 ${Date.now()}`, plannedBudget: 100, currency: 'KWD' } }));
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${c2}/influencers`, headers: auth, payload: { influencerId: inf2, dealType: 'PAID', agreedCost: 500, currency: 'KWD', paymentStatus: 'UNPAID' } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: 'Exec ' } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('reports spend-vs-budget, today, since-yesterday digest and a per-brand rollup', async () => {
    const dash = (await app.inject({ method: 'GET', url: `/api/v1/reports/exec-dashboard?brandId=${brandId}`, headers: auth })).json() as ExecDashboardDTO;

    // Spend vs budget: 1000 + 100 planned, 300 + 500 spent; C2 alone is over budget.
    expect(dash.spendVsBudget.plannedBudget).toBe(1100);
    expect(dash.spendVsBudget.totalSpend).toBe(800);
    expect(dash.spendVsBudget.remaining).toBe(300);
    expect(dash.spendVsBudget.budgetUsedPercent).toBe(73); // round(800 / 1100 * 100)
    expect(dash.spendVsBudget.campaignsOverBudget).toBe(1);

    // Today: C1 starts and ends today; one deliverable is due today. No content.
    expect(dash.today.campaignsStarting).toBe(1);
    expect(dash.today.campaignsEnding).toBe(1);
    expect(dash.today.deliverablesDue).toBe(1);
    expect(dash.today.contentPublished).toBe(0);

    // Since yesterday: both campaigns created, one deliverable completed, two roster adds.
    expect(dash.digest.campaignsCreated).toBe(2);
    expect(dash.digest.deliverablesCompleted).toBe(1);
    expect(dash.digest.rosterAdditions).toBe(2);
    expect(dash.digest.contentRemoved).toBe(0);
    expect(typeof dash.digest.since).toBe('string');

    // Cross-brand rollup narrowed to this brand.
    expect(dash.brands).toHaveLength(1);
    const b = dash.brands[0]!;
    expect(b.brandId).toBe(brandId);
    expect(b.activeCampaigns).toBe(1); // only C1 is ACTIVE
    expect(b.totalSpend).toBe(800);
    expect(b.plannedBudget).toBe(1100);
    expect(b.overBudget).toBe(false); // 800 < 1100 at the brand level (though C2 alone is over)
    expect(b.overdueDeliverables).toBe(1);
    expect(b.contentAlerts).toBe(0);
    expect(b.issueCount).toBe(1); // one overdue deliverable
    expect(typeof dash.generatedAt).toBe('string');
  });

  it('an unscoped call includes the brand in the cross-brand rollup', async () => {
    const dash = (await app.inject({ method: 'GET', url: '/api/v1/reports/exec-dashboard', headers: auth })).json() as ExecDashboardDTO;
    expect(dash.brands.some((x) => x.brandId === brandId)).toBe(true);
    // The overall spend/budget is a superset of this brand's numbers.
    expect(dash.spendVsBudget.plannedBudget).toBeGreaterThanOrEqual(1100);
    expect(dash.spendVsBudget.campaignsOverBudget).toBeGreaterThanOrEqual(1);
  });
});
