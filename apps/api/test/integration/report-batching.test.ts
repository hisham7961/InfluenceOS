import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@influenceos/database';
import { createContext, createServices } from '@influenceos/domain';
import { requests, type ReportDTO } from '@influenceos/contracts';

/**
 * W7-1 / PERF-02 — report generation must not fan out one query per row. The
 * campaign, spend and brand reports each build the whole page from a fixed
 * handful of batched/grouped queries, so a report over N campaigns costs O(1)
 * queries, not O(N). This test proves BOTH that the numbers are still correct
 * AND that the query count stays flat as N grows (the old per-row code issued
 * ~5 queries per campaign — well over 100 for the dataset below).
 */
describe('W7-1 / PERF-02 — reports are batched (no per-row N+1)', () => {
  const prisma = new PrismaClient();
  // A second client with query logging drives the report service so we can count
  // the SQL statements a single report issues.
  const logged = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  let queryCount = 0;
  logged.$on('query', () => {
    queryCount += 1;
  });
  const services = createServices(createContext({ prisma: logged }));

  const TAG = `RPT-${Date.now()}`;
  const N = 24; // old code ≈ N*5 = 120 queries for the campaign report
  let brandId = '';
  let influencerId = '';
  const campaignIds: string[] = [];

  beforeAll(async () => {
    const brand = await prisma.brand.create({
      data: { name: `${TAG} Brand`, slug: `${TAG}-brand`.toLowerCase() },
    });
    brandId = brand.id;
    const influencer = await prisma.influencer.create({ data: { displayName: `${TAG} Inf` } });
    influencerId = influencer.id;
    await prisma.brandInfluencer.create({ data: { brandId, influencerId } });

    // N identical campaigns: 1 paid creator (fee 100, fully paid), 2 deliverables
    // (1 published / 1 planned), 1 non-gift expense of 50. All KWD (single-currency
    // scope). Per campaign: influencers=1, published=1, total=2, spend=150, budget=1000.
    for (let i = 0; i < N; i += 1) {
      const campaign = await prisma.campaign.create({
        data: {
          brandId,
          name: `${TAG} C${i}`,
          slug: `${TAG}-c${i}`.toLowerCase(),
          currency: 'KWD',
          plannedBudget: 1000,
        },
      });
      campaignIds.push(campaign.id);
      const ci = await prisma.campaignInfluencer.create({
        data: {
          campaignId: campaign.id,
          influencerId,
          dealType: 'PAID',
          agreedCost: 100,
          paymentStatus: 'PAID',
          paidAmount: 100,
        },
      });
      await prisma.deliverable.createMany({
        data: [
          { campaignInfluencerId: ci.id, platform: 'INSTAGRAM', type: 'REEL', status: 'PUBLISHED' },
          { campaignInfluencerId: ci.id, platform: 'INSTAGRAM', type: 'STORY', status: 'PLANNED' },
        ],
      });
      await prisma.campaignExpense.create({
        data: { campaignId: campaign.id, type: 'OTHER', amount: 50, paymentStatus: 'UNPAID' },
      });
    }
  });

  afterAll(async () => {
    await prisma.campaignExpense.deleteMany({ where: { campaignId: { in: campaignIds } } }).catch(() => undefined);
    await prisma.deliverable
      .deleteMany({ where: { campaignInfluencer: { campaignId: { in: campaignIds } } } })
      .catch(() => undefined);
    await prisma.campaignInfluencer.deleteMany({ where: { campaignId: { in: campaignIds } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await logged.$disconnect();
  });

  /** Run a report scoped to our brand and return it plus the SQL count it issued. */
  async function run(type: 'campaign' | 'spend' | 'brand'): Promise<{ report: ReportDTO; queries: number }> {
    const filter = requests.reportFilterSchema.parse({ type, brandId });
    queryCount = 0;
    const report = await services.reports.generate(filter);
    return { report, queries: queryCount };
  }

  // A flat ceiling that O(N) code could never meet: the old campaign report alone
  // was ~N*5 = 120 queries. Batched, every report is a single-digit handful.
  const FLAT_QUERY_CEILING = 15;

  it('campaign report: correct per-row + totals from a flat query count', async () => {
    const { report, queries } = await run('campaign');
    expect(report.type).toBe('campaign');
    expect(report.rows).toHaveLength(N);
    expect(report.currency).toBe('KWD');

    for (const row of report.rows) {
      expect(row.influencers).toBe(1);
      expect(row.deliverablesPublished).toBe(1);
      expect(row.deliverablesTotal).toBe(2);
      expect(row.completion).toBe(50);
      expect(row.spend).toBe(150);
      expect(row.budget).toBe(1000);
    }
    // Totals: counts sum, money sums (single currency), percent columns are skipped.
    expect(report.totals?.influencers).toBe(N);
    expect(report.totals?.deliverablesTotal).toBe(2 * N);
    expect(report.totals?.spend).toBe(150 * N);
    expect(report.totals?.budget).toBe(1000 * N);

    expect(queries).toBeLessThan(FLAT_QUERY_CEILING);
  });

  it('spend report: budget/spend/variance correct from a flat query count', async () => {
    const { report, queries } = await run('spend');
    expect(report.rows).toHaveLength(N);
    for (const row of report.rows) {
      expect(row.budget).toBe(1000);
      expect(row.spend).toBe(150);
      expect(row.variance).toBe(850);
    }
    expect(report.totals?.spend).toBe(150 * N);
    expect(queries).toBeLessThan(FLAT_QUERY_CEILING);
  });

  it('brand report: one aggregated row from a flat query count', async () => {
    const { report, queries } = await run('brand');
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.name).toBe(`${TAG} Brand`);
    expect(row.campaigns).toBe(N);
    expect(row.influencers).toBe(1); // one brand-influencer relationship
    expect(row.content).toBe(0);
    expect(row.spend).toBe(150 * N); // Σ (fee 100 + expense 50) across campaigns
    expect(queries).toBeLessThan(FLAT_QUERY_CEILING);
  });
});
