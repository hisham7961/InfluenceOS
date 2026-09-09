import { metrics } from '@influenceos/shared';
import { requests, type ReportColumnDTO, type ReportDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { moneyNumberOr0, subtractMoney, sumMoney, toMoneyNumber, type MoneyInput } from '../lib/money';
import { computeCostSummary } from '../lib/progress';

/**
 * Analytics reports (spec §29). Read-only aggregation across the domain —
 * every row is derived from live data, never fabricated: a missing metric is
 * `null`, not a manufactured zero.
 */

type ReportFilter = z.infer<typeof requests.reportFilterSchema>;
type ReportRow = Record<string, string | number | null>;

const PUBLISHED_DELIVERABLE_STATUSES = ['PUBLISHED', 'VERIFIED'] as const;
const PAID_DEAL_TYPES = ['PAID', 'PAID_PLUS_GIFTED'] as const;
const MAX_ROWS = 500;
const CURRENCY = 'KWD';

/** Sum numeric/currency columns across rows; skip string/date/percent columns.
 *  Currency columns are summed as exact Decimals (never JS float) so a totals
 *  footer of many rows stays penny/fils-accurate; count columns are integers. */
function sumTotals(columns: ReportColumnDTO[], rows: ReportRow[]): Record<string, number | null> {
  const totals: Record<string, number | null> = {};
  for (const col of columns) {
    if (col.type !== 'number' && col.type !== 'currency') continue;
    const values = rows.map((r) => r[col.key]).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) {
      totals[col.key] = null;
    } else if (col.type === 'currency') {
      totals[col.key] = toMoneyNumber(sumMoney(values));
    } else {
      totals[col.key] = values.reduce((a, b) => a + b, 0);
    }
  }
  return totals;
}

export function makeReportService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Campaign scope shared by the campaign/spend/brand reports. */
  function campaignWhere(filter: ReportFilter, overrideBrandId?: string): Prisma.CampaignWhereInput {
    const and: Prisma.CampaignWhereInput[] = [];
    const brandId = overrideBrandId ?? filter.brandId;
    if (brandId) and.push({ brandId });
    if (filter.campaignId) and.push({ id: filter.campaignId });
    if (filter.platform) {
      and.push({
        campaignInfluencers: { some: { deliverables: { some: { platform: filter.platform } } } },
      });
    }
    // Overlap with [from, to]: keep campaigns that haven't ended before `from`
    // and haven't started after `to`. Campaigns missing a boundary date are
    // never excluded by that boundary (we never guess a schedule).
    if (filter.from) and.push({ OR: [{ endDate: null }, { endDate: { gte: filter.from } }] });
    if (filter.to) and.push({ OR: [{ startDate: null }, { startDate: { lte: filter.to } }] });
    return and.length ? { AND: and } : {};
  }

  /** PublishedContent scope shared by the content/brand reports. */
  function contentWhere(filter: ReportFilter, overrideBrandId?: string): Prisma.PublishedContentWhereInput {
    const and: Prisma.PublishedContentWhereInput[] = [];
    const brandId = overrideBrandId ?? filter.brandId;
    if (brandId) and.push({ brandId });
    if (filter.campaignId) and.push({ campaignId: filter.campaignId });
    if (filter.platform) and.push({ platform: filter.platform });
    if (filter.from || filter.to) {
      const range: Prisma.DateTimeFilter = {};
      if (filter.from) range.gte = filter.from;
      if (filter.to) range.lte = filter.to;
      // publishedAt is the natural date to filter on, but it can be null for
      // content detected before a publish date was confirmed — fall back to
      // detectedAt in that case rather than silently dropping the row.
      and.push({ OR: [{ publishedAt: range }, { AND: [{ publishedAt: null }, { detectedAt: range }] }] });
    }
    return and.length ? { AND: and } : {};
  }

  /** Influencer fees (paid deals) + non-gift expenses for a campaign scope. */
  async function spendForCampaigns(where: Prisma.CampaignWhereInput): Promise<number> {
    const [fees, expenses] = await Promise.all([
      prisma.campaignInfluencer.aggregate({
        _sum: { agreedCost: true },
        where: { campaign: where, dealType: { in: [...PAID_DEAL_TYPES] } },
      }),
      prisma.campaignExpense.aggregate({
        _sum: { amount: true },
        where: { campaign: where, type: { not: 'GIFT_PRODUCT' } },
      }),
    ]);
    // Both operands are DB-side Decimal aggregates; add them as Decimals.
    return moneyNumberOr0(sumMoney([fees._sum.agreedCost, expenses._sum.amount]));
  }

  async function campaignReport(filter: ReportFilter): Promise<ReportDTO> {
    const campaigns = await prisma.campaign.findMany({
      where: campaignWhere(filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: {
        id: true,
        name: true,
        status: true,
        currency: true,
        plannedBudget: true,
        brand: { select: { name: true } },
      },
    });

    const columns: ReportColumnDTO[] = [
      { key: 'name', label: 'Campaign', type: 'string' },
      { key: 'brand', label: 'Brand', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'influencers', label: 'Influencers', type: 'number' },
      { key: 'deliverablesPublished', label: 'Published Deliverables', type: 'number' },
      { key: 'deliverablesTotal', label: 'Total Deliverables', type: 'number' },
      { key: 'completion', label: 'Completion', type: 'percent' },
      { key: 'spend', label: 'Spend', type: 'currency' },
      { key: 'budget', label: 'Budget', type: 'currency' },
    ];

    const rows = await Promise.all(
      campaigns.map(async (c): Promise<ReportRow> => {
        const ciWhere = { campaignId: c.id };
        const [influencers, deliverablesTotal, deliverablesPublished, cost] = await Promise.all([
          prisma.campaignInfluencer.count({ where: ciWhere }),
          prisma.deliverable.count({ where: { campaignInfluencer: ciWhere } }),
          prisma.deliverable.count({
            where: { campaignInfluencer: ciWhere, status: { in: [...PUBLISHED_DELIVERABLE_STATUSES] } },
          }),
          computeCostSummary(ctx, c.id, c.currency, toMoneyNumber(c.plannedBudget)),
        ]);
        return {
          name: c.name,
          brand: c.brand.name,
          status: c.status,
          influencers,
          deliverablesPublished,
          deliverablesTotal,
          completion: metrics.completionRate(deliverablesPublished, deliverablesTotal),
          spend: cost.totalSpend,
          budget: cost.plannedBudget,
        };
      }),
    );

    return { type: 'campaign', columns, rows, totals: sumTotals(columns, rows), currency: CURRENCY };
  }

  async function influencerReport(filter: ReportFilter): Promise<ReportDTO> {
    const campaignAnd = campaignWhere(filter);
    const ciWhere: Prisma.CampaignInfluencerWhereInput = { campaign: campaignAnd };

    const where: Prisma.InfluencerWhereInput = { campaignInfluencers: { some: ciWhere } };
    if (filter.platform) where.socialAccounts = { some: { platform: filter.platform } };

    const influencers = await prisma.influencer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: {
        id: true,
        displayName: true,
        socialAccounts: { select: { platform: true, followers: true } },
        campaignInfluencers: {
          where: ciWhere,
          select: {
            agreedCost: true,
            dealType: true,
            paymentStatus: true,
            deliverables: { select: { status: true } },
          },
        },
      },
    });

    const columns: ReportColumnDTO[] = [
      { key: 'name', label: 'Influencer', type: 'string' },
      { key: 'campaigns', label: 'Campaigns', type: 'number' },
      { key: 'followers', label: 'Followers', type: 'number' },
      { key: 'publishedDeliverables', label: 'Published Deliverables', type: 'number' },
      { key: 'totalPaid', label: 'Total Paid', type: 'currency' },
    ];

    const rows = influencers.map((inf): ReportRow => {
      const followerValues = inf.socialAccounts
        .filter((a) => !filter.platform || a.platform === filter.platform)
        .map((a) => a.followers)
        .filter((v): v is number => v != null);
      const followers = followerValues.length ? followerValues.reduce((a, b) => a + b, 0) : null;

      let publishedDeliverables = 0;
      const paidCosts: MoneyInput[] = [];
      for (const ci of inf.campaignInfluencers) {
        for (const d of ci.deliverables) {
          if (d.status === 'PUBLISHED' || d.status === 'VERIFIED') publishedDeliverables += 1;
        }
        if (
          (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED') &&
          ci.paymentStatus === 'PAID'
        ) {
          paidCosts.push(ci.agreedCost);
        }
      }
      // Exact Decimal sum of paid fees (never JS float accumulation).
      const totalPaid = moneyNumberOr0(sumMoney(paidCosts));

      return {
        name: inf.displayName,
        campaigns: inf.campaignInfluencers.length,
        followers,
        publishedDeliverables,
        totalPaid,
      };
    });

    return { type: 'influencer', columns, rows, totals: sumTotals(columns, rows), currency: CURRENCY };
  }

  async function brandReport(filter: ReportFilter): Promise<ReportDTO> {
    const where: Prisma.BrandWhereInput = filter.brandId ? { id: filter.brandId } : {};
    const brands = await prisma.brand.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      take: MAX_ROWS,
      select: { id: true, name: true },
    });

    const columns: ReportColumnDTO[] = [
      { key: 'name', label: 'Brand', type: 'string' },
      { key: 'campaigns', label: 'Campaigns', type: 'number' },
      { key: 'influencers', label: 'Influencers', type: 'number' },
      { key: 'content', label: 'Published Content', type: 'number' },
      { key: 'spend', label: 'Spend', type: 'currency' },
    ];

    const rows = await Promise.all(
      brands.map(async (b): Promise<ReportRow> => {
        const scope = campaignWhere(filter, b.id);
        const [campaigns, influencers, content, spend] = await Promise.all([
          prisma.campaign.count({ where: scope }),
          prisma.brandInfluencer.count({ where: { brandId: b.id } }),
          prisma.publishedContent.count({ where: contentWhere(filter, b.id) }),
          spendForCampaigns(scope),
        ]);
        return { name: b.name, campaigns, influencers, content, spend };
      }),
    );

    return { type: 'brand', columns, rows, totals: sumTotals(columns, rows), currency: CURRENCY };
  }

  async function contentReport(filter: ReportFilter): Promise<ReportDTO> {
    const items = await prisma.publishedContent.findMany({
      where: contentWhere(filter),
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: {
        platform: true,
        availabilityStatus: true,
        influencer: { select: { displayName: true } },
        campaign: { select: { name: true } },
        metricSnapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { views: true, likes: true, comments: true },
        },
      },
    });

    const columns: ReportColumnDTO[] = [
      { key: 'platform', label: 'Platform', type: 'string' },
      { key: 'influencer', label: 'Influencer', type: 'string' },
      { key: 'campaign', label: 'Campaign', type: 'string' },
      { key: 'views', label: 'Views', type: 'number' },
      { key: 'likes', label: 'Likes', type: 'number' },
      { key: 'comments', label: 'Comments', type: 'number' },
      { key: 'status', label: 'Status', type: 'string' },
    ];

    const rows = items.map((pc): ReportRow => {
      const snap = pc.metricSnapshots[0] ?? null;
      return {
        platform: pc.platform,
        influencer: pc.influencer?.displayName ?? null,
        campaign: pc.campaign?.name ?? null,
        views: snap?.views ?? null,
        likes: snap?.likes ?? null,
        comments: snap?.comments ?? null,
        status: pc.availabilityStatus,
      };
    });

    return { type: 'content', columns, rows, totals: sumTotals(columns, rows), currency: CURRENCY };
  }

  async function spendReport(filter: ReportFilter): Promise<ReportDTO> {
    const campaigns = await prisma.campaign.findMany({
      where: campaignWhere(filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: { id: true, name: true, currency: true, plannedBudget: true },
    });

    const columns: ReportColumnDTO[] = [
      { key: 'name', label: 'Campaign', type: 'string' },
      { key: 'budget', label: 'Budget', type: 'currency' },
      { key: 'spend', label: 'Spend', type: 'currency' },
      { key: 'variance', label: 'Variance', type: 'currency' },
    ];

    const rows = await Promise.all(
      campaigns.map(async (c): Promise<ReportRow> => {
        const cost = await computeCostSummary(ctx, c.id, c.currency, toMoneyNumber(c.plannedBudget));
        const budget = cost.plannedBudget;
        const spend = cost.totalSpend;
        return { name: c.name, budget, spend, variance: subtractMoney(budget, spend) };
      }),
    );

    return { type: 'spend', columns, rows, totals: sumTotals(columns, rows), currency: CURRENCY };
  }

  async function generate(filter: ReportFilter): Promise<ReportDTO> {
    switch (filter.type) {
      case 'campaign':
        return campaignReport(filter);
      case 'influencer':
        return influencerReport(filter);
      case 'brand':
        return brandReport(filter);
      case 'content':
        return contentReport(filter);
      case 'spend':
        return spendReport(filter);
      default: {
        const exhaustive: never = filter.type;
        throw AppError.badRequest(`Unsupported report type: ${String(exhaustive)}`);
      }
    }
  }

  return { generate };
}

export type ReportService = ReturnType<typeof makeReportService>;
