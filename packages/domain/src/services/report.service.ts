import { metrics } from '@influenceos/shared';
import { requests, type ReportColumnDTO, type ReportDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import {
  moneyNumberOr0,
  resolveScopeCurrency,
  subtractMoney,
  sumMoney,
  toMoneyNumber,
  type MoneyInput,
} from '../lib/money';
import { computeCampaignProgressBatch } from '../lib/progress';
import { scopedBrandIds, scopedCountryCodes } from '../lib/scope';

/**
 * Analytics reports (spec §29). Read-only aggregation across the domain —
 * every row is derived from live data, never fabricated: a missing metric is
 * `null`, not a manufactured zero.
 */

type ReportFilter = z.infer<typeof requests.reportFilterSchema>;
type ReportRow = Record<string, string | number | null>;

const PAID_DEAL_TYPES = ['PAID', 'PAID_PLUS_GIFTED'] as const;
const MAX_ROWS = 500;

/** Sum numeric/currency columns across rows; skip string/date/percent columns.
 *  Currency columns are summed as exact Decimals (never JS float) so a totals
 *  footer of many rows stays penny/fils-accurate; count columns are integers.
 *  When the scope spans MORE THAN ONE currency (`mixed`), a single-currency
 *  money grand total would be a lie, so currency-column totals are suppressed
 *  (`null`) — count columns still total normally (DB-03/finance). */
function sumTotals(
  columns: ReportColumnDTO[],
  rows: ReportRow[],
  mixed = false,
): Record<string, number | null> {
  const totals: Record<string, number | null> = {};
  for (const col of columns) {
    if (col.type !== 'number' && col.type !== 'currency') continue;
    const values = rows.map((r) => r[col.key]).filter((v): v is number => typeof v === 'number');
    if (col.type === 'currency') {
      totals[col.key] = mixed || values.length === 0 ? null : toMoneyNumber(sumMoney(values));
    } else {
      totals[col.key] = values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
    }
  }
  return totals;
}

export function makeReportService(ctx: DomainContext) {
  const { prisma } = ctx;

  /**
   * Campaign scope shared by the campaign/spend/brand reports.
   *
   * Security & Authorization Freeze Gate (aggregate-leak-audit, spec
   * §49-55) — previously this composed ONLY the explicit `brandId`/
   * `campaignId` query filters, never the actor's own brand scope, so
   * `GET /reports?type=campaign` (or spend/brand) with no explicit brandId
   * returned EVERY brand's campaigns/budget/spend to any authenticated
   * brand-scoped actor. Mirrors campaign.service.ts's buildWhere() exactly:
   * an out-of-scope explicit brandId matches nothing rather than silently
   * widening; an unscoped actor (ADMIN, or no explicit UserBrandAccess rows)
   * is untouched.
   */
  async function campaignWhere(filter: ReportFilter, overrideBrandId?: string): Promise<Prisma.CampaignWhereInput> {
    const and: Prisma.CampaignWhereInput[] = [];
    const brandId = overrideBrandId ?? filter.brandId;
    const brandScope = await scopedBrandIds(ctx);
    if (brandId) {
      and.push({ brandId: brandScope && !brandScope.includes(brandId) ? { in: [] } : brandId });
    } else if (brandScope) {
      and.push({ brandId: { in: brandScope } });
    }
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

  /** PublishedContent scope shared by the content/brand reports — same
   *  brand-scope posture as campaignWhere() above (see its doc comment). */
  async function contentWhere(filter: ReportFilter, overrideBrandId?: string): Promise<Prisma.PublishedContentWhereInput> {
    const and: Prisma.PublishedContentWhereInput[] = [];
    const brandId = overrideBrandId ?? filter.brandId;
    const brandScope = await scopedBrandIds(ctx);
    if (brandId) {
      and.push({ brandId: brandScope && !brandScope.includes(brandId) ? { in: [] } : brandId });
    } else if (brandScope) {
      and.push({ brandId: { in: brandScope } });
    }
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

  /** The distinct currency of the campaigns in scope → a single label plus a
   *  `mixed` flag. When more than one currency is present the report is labelled
   *  'MIXED' and its money grand totals are suppressed rather than summed across
   *  currencies (DB-03/finance). */
  async function scopeCurrency(where: Prisma.CampaignWhereInput): Promise<{ currency: string; mixed: boolean }> {
    const rows = await prisma.campaign.findMany({ where, select: { currency: true }, distinct: ['currency'] });
    return resolveScopeCurrency(rows.map((r) => r.currency));
  }

  async function campaignReport(filter: ReportFilter): Promise<ReportDTO> {
    const where = await campaignWhere(filter);
    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: {
        id: true,
        name: true,
        status: true,
        currency: true,
        plannedBudget: true,
        startDate: true,
        endDate: true,
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

    // Batch the whole page's progress + cost in a fixed number of queries
    // (PERF-02 / W7-1) — no per-campaign fan-out. The completion column keeps its
    // own unrounded completionRate (progress rounds), sourced from batched counts.
    const progress = await computeCampaignProgressBatch(ctx, campaigns);
    const rows = campaigns.map((c): ReportRow => {
      const p = progress.get(c.id)!;
      return {
        name: c.name,
        brand: c.brand.name,
        status: c.status,
        influencers: p.influencersTotal,
        deliverablesPublished: p.deliverablesPublished,
        deliverablesTotal: p.deliverablesTotal,
        completion: metrics.completionRate(p.deliverablesPublished, p.deliverablesTotal),
        spend: p.spend,
        budget: p.plannedBudget,
      };
    });

    const scope = await scopeCurrency(where);
    return { type: 'campaign', columns, rows, totals: sumTotals(columns, rows, scope.mixed), currency: scope.currency };
  }

  async function influencerReport(filter: ReportFilter): Promise<ReportDTO> {
    const campaignAnd = await campaignWhere(filter);
    const ciWhere: Prisma.CampaignInfluencerWhereInput = { campaign: campaignAnd };

    const where: Prisma.InfluencerWhereInput = { campaignInfluencers: { some: ciWhere } };
    if (filter.platform) where.socialAccounts = { some: { platform: filter.platform } };
    // Country scope (aggregate-leak-audit) — this report's rows carry real
    // creator names/paid amounts, not just a count; a country-scoped actor
    // (e.g. KW-only) must never see a Saudi creator's row here just because
    // that creator collaborated on an in-scope brand's campaign.
    const countryScope = await scopedCountryCodes(ctx);
    if (countryScope) where.countryCode = { in: countryScope };

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

    const scope = await scopeCurrency(campaignAnd);
    return { type: 'influencer', columns, rows, totals: sumTotals(columns, rows, scope.mixed), currency: scope.currency };
  }

  async function brandReport(filter: ReportFilter): Promise<ReportDTO> {
    // Brand scope (aggregate-leak-audit) — previously `filter.brandId ? {
    // id: filter.brandId } : {}`, so an unfiltered call listed EVERY brand
    // in the org (name, campaign count, influencer count, content count,
    // spend) to any authenticated brand-scoped actor. Same posture as every
    // other buildWhere() here: an out-of-scope explicit brandId matches
    // nothing rather than silently widening.
    const brandScope = await scopedBrandIds(ctx);
    const where: Prisma.BrandWhereInput = filter.brandId
      ? { id: brandScope && !brandScope.includes(filter.brandId) ? { in: [] } : filter.brandId }
      : brandScope
        ? { id: { in: brandScope } }
        : {};
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

    const brandIds = brands.map((b) => b.id);
    if (brandIds.length === 0) {
      const scope = await scopeCurrency(await campaignWhere(filter));
      return { type: 'brand', columns, rows: [], totals: sumTotals(columns, [], scope.mixed), currency: scope.currency };
    }

    // Country scope — the "influencers"/"content" per-brand counts must
    // exclude out-of-scope-country creators/content too (never just brand
    // scope alone), same principle as data-quality.service.ts's report().
    const countryScope = await scopedCountryCodes(ctx);
    const influencerCountryWhere = countryScope ? { influencer: { countryCode: { in: countryScope } } } : {};
    const contentCountryWhere: Prisma.PublishedContentWhereInput = countryScope
      ? { OR: [{ influencerId: null }, { influencer: { countryCode: { in: countryScope } } }] }
      : {};

    // Every per-brand aggregate in a fixed handful of queries (PERF-02 / W7-1) —
    // no per-brand fan-out. Campaign counts and spend fold from the in-scope
    // campaigns; brand-influencer and content counts are grouped in one query each.
    const scopedCampaigns = await prisma.campaign.findMany({
      where: { AND: [await campaignWhere(filter), { brandId: { in: brandIds } }] },
      select: { id: true, brandId: true },
    });
    const campaignIds = scopedCampaigns.map((c) => c.id);

    const [biCounts, contentCounts, feeSums, expenseSums] = await Promise.all([
      prisma.brandInfluencer.groupBy({
        by: ['brandId'],
        where: { brandId: { in: brandIds }, ...influencerCountryWhere },
        _count: { _all: true },
      }),
      prisma.publishedContent.groupBy({
        by: ['brandId'],
        where: { AND: [await contentWhere(filter), { brandId: { in: brandIds } }, contentCountryWhere] },
        _count: { _all: true },
      }),
      campaignIds.length
        ? prisma.campaignInfluencer.groupBy({
            by: ['campaignId'],
            where: { campaignId: { in: campaignIds }, dealType: { in: [...PAID_DEAL_TYPES] } },
            _sum: { agreedCost: true },
          })
        : Promise.resolve([] as { campaignId: string; _sum: { agreedCost: Prisma.Decimal | null } }[]),
      campaignIds.length
        ? prisma.campaignExpense.groupBy({
            by: ['campaignId'],
            where: { campaignId: { in: campaignIds }, type: { not: 'GIFT_PRODUCT' } },
            _sum: { amount: true },
          })
        : Promise.resolve([] as { campaignId: string; _sum: { amount: Prisma.Decimal | null } }[]),
    ]);

    const feeByCampaign = new Map(feeSums.map((f) => [f.campaignId, f._sum.agreedCost]));
    const expenseByCampaign = new Map(expenseSums.map((e) => [e.campaignId, e._sum.amount]));
    const campaignCountByBrand = new Map<string, number>();
    // Per brand, collect each campaign's paid fees + non-gift expenses; sum them
    // as exact Decimals (currency-agnostic, matching the previous spendForCampaigns).
    const spendPartsByBrand = new Map<string, MoneyInput[]>();
    for (const c of scopedCampaigns) {
      campaignCountByBrand.set(c.brandId, (campaignCountByBrand.get(c.brandId) ?? 0) + 1);
      const parts = spendPartsByBrand.get(c.brandId) ?? [];
      parts.push(feeByCampaign.get(c.id) ?? null, expenseByCampaign.get(c.id) ?? null);
      spendPartsByBrand.set(c.brandId, parts);
    }
    const influencersByBrand = new Map(biCounts.map((x) => [x.brandId, x._count._all]));
    const contentByBrand = new Map(contentCounts.map((x) => [x.brandId, x._count._all]));

    const rows: ReportRow[] = brands.map((b) => ({
      name: b.name,
      campaigns: campaignCountByBrand.get(b.id) ?? 0,
      influencers: influencersByBrand.get(b.id) ?? 0,
      content: contentByBrand.get(b.id) ?? 0,
      spend: moneyNumberOr0(sumMoney(spendPartsByBrand.get(b.id) ?? [])),
    }));

    const scope = await scopeCurrency(await campaignWhere(filter));
    return { type: 'brand', columns, rows, totals: sumTotals(columns, rows, scope.mixed), currency: scope.currency };
  }

  async function contentReport(filter: ReportFilter): Promise<ReportDTO> {
    // Country scope — a content row directly names the creator
    // (`influencer.displayName`); content with no influencer stays visible
    // (never a stored country to check), same posture as brandReport() above.
    const countryScope = await scopedCountryCodes(ctx);
    const baseContentWhere = await contentWhere(filter);
    const where: Prisma.PublishedContentWhereInput = countryScope
      ? { AND: [baseContentWhere, { OR: [{ influencerId: null }, { influencer: { countryCode: { in: countryScope } } }] }] }
      : baseContentWhere;
    const items = await prisma.publishedContent.findMany({
      where,
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: {
        platform: true,
        availabilityStatus: true,
        dataSource: true,
        lastMetricsSyncAt: true,
        influencer: { select: { displayName: true } },
        campaign: { select: { name: true } },
        metricSnapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: {
            views: true,
            likes: true,
            comments: true,
            shares: true,
            saves: true,
            reposts: true,
            engagementRate: true,
            capturedAt: true,
            source: true,
          },
        },
      },
    });

    // Efficiency (engagement + rate) and staleness (provenance + last sync) are
    // shown here so metric quality is legible in the report itself (W6-1).
    const columns: ReportColumnDTO[] = [
      { key: 'platform', label: 'Platform', type: 'string' },
      { key: 'influencer', label: 'Influencer', type: 'string' },
      { key: 'campaign', label: 'Campaign', type: 'string' },
      { key: 'views', label: 'Views', type: 'number' },
      { key: 'engagement', label: 'Engagement', type: 'number' },
      { key: 'engagementRate', label: 'Eng. Rate', type: 'percent' },
      { key: 'source', label: 'Source', type: 'string' },
      { key: 'synced', label: 'Metrics Synced', type: 'date' },
      { key: 'status', label: 'Status', type: 'string' },
    ];

    const rows = items.map((pc): ReportRow => {
      const snap = pc.metricSnapshots[0] ?? null;
      const syncedAt = pc.lastMetricsSyncAt ?? snap?.capturedAt ?? null;
      return {
        platform: pc.platform,
        influencer: pc.influencer?.displayName ?? null,
        campaign: pc.campaign?.name ?? null,
        views: snap?.views ?? null,
        engagement: snap
          ? metrics.totalEngagements({ likes: snap.likes, comments: snap.comments, shares: snap.shares, saves: snap.saves, reposts: snap.reposts })
          : null,
        engagementRate: snap?.engagementRate ?? null,
        // Provenance of the latest metrics — snapshot source, else the row's own.
        source: snap?.source ?? pc.dataSource,
        synced: syncedAt ? syncedAt.toISOString() : null,
        status: pc.availabilityStatus,
      };
    });

    const scope = await scopeCurrency(await campaignWhere(filter));
    return { type: 'content', columns, rows, totals: sumTotals(columns, rows, scope.mixed), currency: scope.currency };
  }

  async function spendReport(filter: ReportFilter): Promise<ReportDTO> {
    const campaigns = await prisma.campaign.findMany({
      where: await campaignWhere(filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
      select: { id: true, name: true, currency: true, plannedBudget: true, startDate: true, endDate: true },
    });

    const columns: ReportColumnDTO[] = [
      { key: 'name', label: 'Campaign', type: 'string' },
      { key: 'budget', label: 'Budget', type: 'currency' },
      { key: 'spend', label: 'Spend', type: 'currency' },
      { key: 'variance', label: 'Variance', type: 'currency' },
    ];

    // Budget/spend for the whole page in a fixed number of queries (PERF-02 /
    // W7-1) — the same batched cost the campaign list uses, no per-campaign fan-out.
    const progress = await computeCampaignProgressBatch(ctx, campaigns);
    const rows = campaigns.map((c): ReportRow => {
      const p = progress.get(c.id)!;
      const budget = p.plannedBudget;
      const spend = p.spend;
      return { name: c.name, budget, spend, variance: subtractMoney(budget, spend) };
    });

    const scope = resolveScopeCurrency(campaigns.map((c) => c.currency));
    return { type: 'spend', columns, rows, totals: sumTotals(columns, rows, scope.mixed), currency: scope.currency };
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
