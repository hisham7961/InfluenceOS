import {
  METRICS_FRESHNESS_DAYS,
  businessToday,
  isDeliverableDelivered,
  median,
  metrics,
  overdueAfter,
  resolvePeriod,
} from '@influenceos/shared';
import {
  requests,
  type CampaignEfficiencyDTO,
  type ContentEfficiencyDTO,
  type CreatorLeaderboardDTO,
  type CreatorTier,
  type DataSource,
  type ExecBrandRollupDTO,
  type ExecDashboardDTO,
  type LeaderboardEntryDTO,
  type MetricSourceCountDTO,
  type SpendVsBudgetLineDTO,
  type TrendsDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { moneyNumberOr0, percentOf, sumMoney, toDecimal, toMoneyNumber } from '../lib/money';
import { computeCostSummary } from '../lib/progress';
import { loadCreatorResults, postCostPerView } from '../lib/creator-results';
import { deliveredWhere, dueWithinWhere, overdueWhere } from '../lib/deliverable-rules';
import { removedSinceWhere } from '../lib/digest';
import { loadCampaignMoney, participationMoney, sumCampaignMoney, EMPTY_CAMPAIGN_MONEY } from '../lib/spend';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';
import { hasCapability } from '../lib/capabilities';
import { loadPostMetrics } from '../lib/post-metrics';
import { defaultTrendRange, periodKpis, trendPoints } from '../lib/results';
import { memo } from '../lib/memo';

type LeaderboardQuery = z.infer<typeof requests.leaderboardQuerySchema>;
type ExecDashboardQuery = z.infer<typeof requests.execDashboardQuerySchema>;
type TrendsQuery = z.infer<typeof requests.trendsQuerySchema>;

// Content that has left the feed (a brand-health alert).
const REMOVED_CONTENT = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;

// A collaboration only counts once committed — an invited/declined/dropped
// participation never inflates a creator's standing (consistent with DB-10).
const COMMITTED = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

/**
 * Tier from the score (P2.7: results and reliability, not only volume). A
 * creator who hasn't delivered anything yet is NEW whatever else is known.
 */
function tierFor(score: number, published: number): CreatorTier {
  if (published < 1) return 'NEW';
  if (score >= 60) return 'GOLD';
  if (score >= 30) return 'SILVER';
  return 'BRONZE';
}

/**
 * The leaderboard score (P2.7): delivered work and repeat business, how
 * reliably they post on time, and how many people see their posts.
 */
export function creatorScore(e: {
  deliverablesPublished: number;
  campaigns: number;
  repeatCollaborations: number;
  onTimeRate: number | null;
  medianViews: number | null;
}): number {
  return Math.round(
    e.deliverablesPublished * 4 +
      e.campaigns * 3 +
      e.repeatCollaborations * 4 +
      (e.onTimeRate ?? 0) * 20 +
      Math.log10((e.medianViews ?? 0) + 1) * 6,
  );
}

export function makeAnalyticsService(ctx: DomainContext) {
  const { prisma } = ctx;

  /**
   * Creator performance leaderboard (W6-2). Ranks creators by delivered work so
   * "who are our strongest / weakest creators?" is answerable. Server-computed
   * (no browser math). Respects the caller's brand scope (W4-4) and an optional
   * brand filter.
   */
  async function creatorLeaderboard(query: LeaderboardQuery): Promise<CreatorLeaderboardDTO> {
    const scope = await scopedBrandIds(ctx);
    const brandFilter: Prisma.CampaignWhereInput = {
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(scope ? { brandId: { in: scope } } : {}),
    };

    const rows = await prisma.campaignInfluencer.findMany({
      where: {
        participationStatus: { in: [...COMMITTED] },
        campaign: brandFilter,
      },
      select: {
        influencerId: true,
        agreedCost: true,
        dealType: true,
        participationStatus: true,
        paymentStatus: true,
        paidAmount: true,
        influencer: {
          select: { displayName: true, primaryUsername: true, category: true, avatarOverrideUrl: true, resolvedAvatarUrl: true },
        },
        campaign: { select: { brandId: true } },
        deliverables: { select: { status: true, type: true, dueDate: true, publishedAt: true } },
      },
      take: 5000,
    });

    // Results: every post by these creators the reader can see, with its
    // latest numbers (one query).
    const creatorIds = [...new Set(rows.map((r) => r.influencerId))];
    const posts = creatorIds.length
      ? await loadPostMetrics(prisma, {
          influencerId: { in: creatorIds },
          ...(query.brandId ? { brandId: query.brandId } : scope ? { brandId: { in: scope } } : {}),
        })
      : [];
    const postsBy = new Map<string, typeof posts>();
    for (const p of posts) {
      if (!p.influencerId) continue;
      const list = postsBy.get(p.influencerId) ?? [];
      list.push(p);
      postsBy.set(p.influencerId, list);
    }

    type Acc = {
      influencerId: string;
      displayName: string;
      primaryUsername: string | null;
      avatarUrl: string | null;
      category: string | null;
      campaigns: number;
      brands: Set<string>;
      deliverablesTotal: number;
      deliverablesPublished: number;
      paid: Prisma.Decimal[];
      onTime: number;
      judged: number;
    };
    const byInfluencer = new Map<string, Acc>();

    for (const r of rows) {
      let acc = byInfluencer.get(r.influencerId);
      if (!acc) {
        acc = {
          influencerId: r.influencerId,
          displayName: r.influencer.displayName,
          primaryUsername: r.influencer.primaryUsername,
          avatarUrl: r.influencer.avatarOverrideUrl ?? r.influencer.resolvedAvatarUrl ?? null,
          category: r.influencer.category,
          campaigns: 0,
          brands: new Set<string>(),
          deliverablesTotal: 0,
          deliverablesPublished: 0,
          paid: [],
          onTime: 0,
          judged: 0,
        };
        byInfluencer.set(r.influencerId, acc);
      }
      acc.campaigns += 1;
      acc.brands.add(r.campaign.brandId);
      const planned = r.deliverables.filter((d) => d.status !== 'CANCELLED');
      acc.deliverablesTotal += planned.length;
      acc.deliverablesPublished += planned.filter(isDeliverableDelivered).length;
      for (const d of planned) {
        if (!d.dueDate || !d.publishedAt) continue;
        acc.judged += 1;
        if (d.publishedAt < overdueAfter(d.dueDate)) acc.onTime += 1;
      }
      // Part payments count as paid too (what was actually paid).
      const paidPart = participationMoney(r).paid;
      if (paidPart.gt(0)) acc.paid.push(paidPart);
    }

    const entries: LeaderboardEntryDTO[] = [...byInfluencer.values()].map((a) => {
      const repeatCollaborations = Math.max(0, a.campaigns - 1);
      const mine = postsBy.get(a.influencerId) ?? [];
      const medianViews = median(mine.map((p) => p.views).filter((v): v is number => v != null));
      const medianEngagementRate = median(mine.map((p) => p.engagementRate).filter((v): v is number => v != null));
      const onTimeRate = a.judged ? Math.round((a.onTime / a.judged) * 1000) / 1000 : null;
      const score = creatorScore({
        deliverablesPublished: a.deliverablesPublished,
        campaigns: a.campaigns,
        repeatCollaborations,
        onTimeRate,
        medianViews,
      });
      return {
        influencerId: a.influencerId,
        displayName: a.displayName,
        primaryUsername: a.primaryUsername,
        avatarUrl: a.avatarUrl,
        category: a.category,
        campaigns: a.campaigns,
        brands: a.brands.size,
        repeatCollaborations,
        deliverablesTotal: a.deliverablesTotal,
        deliverablesPublished: a.deliverablesPublished,
        completionRate: a.deliverablesTotal > 0 ? a.deliverablesPublished / a.deliverablesTotal : null,
        totalPaid: a.paid.length ? moneyNumberOr0(sumMoney(a.paid)) : null,
        tier: tierFor(score, a.deliverablesPublished),
        score,
        medianViews: medianViews == null ? null : Math.round(medianViews),
        medianEngagementRate: medianEngagementRate == null ? null : Math.round(medianEngagementRate * 100) / 100,
        onTimeRate,
      };
    });

    entries.sort(
      (x, y) => y.score - x.score || y.deliverablesPublished - x.deliverablesPublished || x.displayName.localeCompare(y.displayName),
    );

    return { entries: entries.slice(0, query.limit), generatedAt: new Date().toISOString() };
  }

  /**
   * Executive overview (W6-3). Answers the five exec questions the weekly
   * dashboard could not: spend **vs budget**, what happened **today**, what
   * changed **since yesterday**, and **which brands** have issues (cross-brand
   * rollup). Server-computed (no browser math), brand-scope aware (W4-4), and
   * computed in a fixed number of queries regardless of data size — no
   * per-brand or per-campaign fan-out.
   */
  async function executiveDashboard(query: ExecDashboardQuery): Promise<ExecDashboardDTO> {
    return memo(`exec:${ctx.actor?.id ?? 'system'}:${JSON.stringify(query)}`, () => computeExecutiveDashboard(query));
  }

  async function computeExecutiveDashboard(query: ExecDashboardQuery): Promise<ExecDashboardDTO> {
    const scope = await scopedBrandIds(ctx);
    // A single-brand filter must sit inside the caller's scope, else it is
    // indistinguishable from a brand that does not exist (least privilege).
    if (query.brandId && isBrandOutOfScope(scope, query.brandId)) throw AppError.notFound('Brand');
    // null → every brand; otherwise the concrete set (the filter narrows scope).
    const brandIds: string[] | null = query.brandId ? [query.brandId] : scope;

    const now = new Date();
    // "Today" is the Kuwait calendar day, not UTC's (which starts at 03:00 there).
    const { start: startOfToday, end: endOfToday } = businessToday(now);
    const dayAgo = new Date(now.getTime() - 864e5);

    const inBrands = <T extends object>(filter: T): T | (T & { brandId: { in: string[] } }) =>
      brandIds ? { ...filter, brandId: { in: brandIds } } : filter;
    const campBrand = brandIds ? { brandId: { in: brandIds } } : {};
    const pcBrand = brandIds ? { brandId: { in: brandIds } } : {};
    const delBrand = brandIds ? { campaignInfluencer: { campaign: { brandId: { in: brandIds } } } } : {};
    const ciBrand = brandIds ? { campaign: { brandId: { in: brandIds } } } : {};

    const [brands, campaigns] = await Promise.all([
      prisma.brand.findMany({ where: brandIds ? { id: { in: brandIds } } : {}, select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } }),
      // Draft and cancelled campaigns aren't money anyone has committed.
      prisma.campaign.findMany({
        where: { ...campBrand, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: { id: true, brandId: true, status: true, plannedBudget: true, currency: true },
      }),
    ]);
    const campaignIds = campaigns.map((c) => c.id);

    // Per-campaign money under the shared rules (spend.ts), in two queries.
    const moneyByCampaign = await loadCampaignMoney(prisma, campaignIds);

    const [
      todayContent,
      todayDeliverables,
      todayStarting,
      todayEnding,
      digestContent,
      digestDeliverables,
      digestCampaignsCreated,
      digestCampaignsCompleted,
      digestRoster,
      digestRemoved,
      overdueRows,
      alertGroups,
      digestShipmentsDelivered,
      digestShipmentsFailed,
      ugcAwaitingReviewCount,
    ] = await Promise.all([
      prisma.publishedContent.count({ where: { detectedAt: { gte: startOfToday, lt: endOfToday }, ...pcBrand } }),
      prisma.deliverable.count({ where: { AND: [dueWithinWhere(0, now), delBrand] } }),
      prisma.campaign.count({ where: { startDate: { gte: startOfToday, lt: endOfToday }, ...campBrand } }),
      prisma.campaign.count({ where: { endDate: { gte: startOfToday, lt: endOfToday }, ...campBrand } }),
      prisma.publishedContent.count({ where: { detectedAt: { gte: dayAgo }, ...pcBrand } }),
      prisma.deliverable.count({ where: { AND: [deliveredWhere, { updatedAt: { gte: dayAgo } }, delBrand] } }),
      prisma.campaign.count({ where: { createdAt: { gte: dayAgo }, ...campBrand } }),
      prisma.campaign.count({ where: { status: 'COMPLETED', updatedAt: { gte: dayAgo }, ...campBrand } }),
      prisma.campaignInfluencer.count({ where: { createdAt: { gte: dayAgo }, ...ciBrand } }),
      // Posts that went down in the last day (a recorded status change), not
      // every post still down that happened to be re-checked.
      prisma.publishedContent.count({ where: { AND: [removedSinceWhere(dayAgo), pcBrand] } }),
      prisma.deliverable.findMany({
        where: { AND: [overdueWhere(now), delBrand] },
        select: { campaignInfluencer: { select: { campaign: { select: { brandId: true } } } } },
      }),
      prisma.publishedContent.groupBy({ by: ['brandId'], _count: true, where: inBrands({ availabilityStatus: { in: [...REMOVED_CONTENT] } }) }),
      prisma.productShipment.count({ where: { status: 'DELIVERED', updatedAt: { gte: dayAgo }, ...delBrand } }),
      prisma.productShipment.count({ where: { status: 'FAILED', updatedAt: { gte: dayAgo }, ...delBrand } }),
      prisma.deliverableSubmission.count({ where: { status: 'IN_REVIEW', deliverable: delBrand } }),
    ]);

    // Spend against budget per currency — overall and per brand. Amounts in
    // different currencies are never added together (P2.7).
    type Line = { budget: Prisma.Decimal; spend: Prisma.Decimal; unpaid: Prisma.Decimal; campaigns: number };
    const emptyLine = (): Line => ({ budget: new Prisma.Decimal(0), spend: new Prisma.Decimal(0), unpaid: new Prisma.Decimal(0), campaigns: 0 });
    const totals = new Map<string, Line>();
    const brandLines = new Map<string, Map<string, Line>>();
    let campaignsOverBudget = 0;
    const activeByBrand = new Map<string, number>();
    for (const c of campaigns) {
      const budget = toDecimal(c.plannedBudget) ?? new Prisma.Decimal(0);
      const money = moneyByCampaign.get(c.id) ?? EMPTY_CAMPAIGN_MONEY;
      const ccy = c.currency || 'KWD';
      if (budget.gt(0) && money.totalSpend.gt(budget)) campaignsOverBudget += 1;
      if (c.status === 'ACTIVE') activeByBrand.set(c.brandId, (activeByBrand.get(c.brandId) ?? 0) + 1);
      const perBrand = brandLines.get(c.brandId) ?? new Map<string, Line>();
      brandLines.set(c.brandId, perBrand);
      for (const map of [totals, perBrand]) {
        const line = map.get(ccy) ?? emptyLine();
        line.budget = line.budget.plus(budget);
        line.spend = line.spend.plus(money.totalSpend);
        line.unpaid = line.unpaid.plus(money.unpaid);
        line.campaigns += 1;
        map.set(ccy, line);
      }
    }
    const toLine = (currency: string, l: Line): SpendVsBudgetLineDTO => ({
      currency,
      plannedBudget: moneyNumberOr0(l.budget),
      totalSpend: moneyNumberOr0(l.spend),
      remaining: l.budget.minus(l.spend).toNumber(),
      budgetUsedPercent: percentOf(l.spend, l.budget),
      unpaidSpend: moneyNumberOr0(l.unpaid),
      campaigns: l.campaigns,
    });
    // Main currency first: the most budget, then the most spend.
    const byCurrency = (m: Map<string, Line>) =>
      [...m.entries()]
        .map(([ccy, l]) => toLine(ccy, l))
        .sort((a, b) => b.plannedBudget - a.plannedBudget || b.totalSpend - a.totalSpend || a.currency.localeCompare(b.currency));
    const overall = byCurrency(totals);
    const main = overall[0] ?? toLine('KWD', emptyLine());

    const overdueByBrand = new Map<string, number>();
    for (const d of overdueRows) {
      const bId = d.campaignInfluencer.campaign.brandId;
      overdueByBrand.set(bId, (overdueByBrand.get(bId) ?? 0) + 1);
    }
    const alertsByBrand = new Map<string, number>();
    for (const g of alertGroups) {
      if (g.brandId) alertsByBrand.set(g.brandId, g._count);
    }

    const rollup: ExecBrandRollupDTO[] = brands.map((b) => {
      const lines = byCurrency(brandLines.get(b.id) ?? new Map());
      const line = lines[0] ?? toLine(main.currency, emptyLine());
      const overBudget = lines.some((l) => l.plannedBudget > 0 && l.totalSpend > l.plannedBudget);
      const overdueDeliverables = overdueByBrand.get(b.id) ?? 0;
      const contentAlerts = alertsByBrand.get(b.id) ?? 0;
      return {
        brandId: b.id,
        brandName: b.name,
        slug: b.slug,
        activeCampaigns: activeByBrand.get(b.id) ?? 0,
        totalSpend: line.totalSpend,
        plannedBudget: line.plannedBudget,
        budgetUsedPercent: line.budgetUsedPercent,
        overBudget,
        overdueDeliverables,
        contentAlerts,
        currency: line.currency,
        mixed: lines.length > 1,
        issueCount: overdueDeliverables + contentAlerts + (overBudget ? 1 : 0),
      };
    });
    rollup.sort((a, b) => b.issueCount - a.issueCount || b.totalSpend - a.totalSpend || a.brandName.localeCompare(b.brandName));

    // Results this period vs the one before (P2.7). Payments need finance access.
    const resolved = resolvePeriod(query.period, now, { from: query.from, to: query.to });
    const canSeeMoney = await hasCapability(ctx, 'FINANCE_VIEW');
    const resultsScope = { brandIds };
    const [current, previous] = await Promise.all([
      periodKpis(ctx, resultsScope, resolved.from, resolved.to, canSeeMoney),
      periodKpis(ctx, resultsScope, resolved.previousFrom, resolved.previousTo, canSeeMoney),
    ]);

    return {
      currency: main.currency,
      spendVsBudget: {
        currency: main.currency,
        plannedBudget: main.plannedBudget,
        totalSpend: main.totalSpend,
        remaining: main.remaining,
        budgetUsedPercent: main.budgetUsedPercent,
        campaignsOverBudget,
        unpaidSpend: main.unpaidSpend,
        mixed: overall.length > 1,
        byCurrency: overall,
      },
      period: {
        period: resolved.period,
        from: resolved.fromKey,
        to: resolved.toKey,
        previousFrom: resolved.previousFromKey,
        previousTo: resolved.previousToKey,
        current,
        previous,
      },
      today: {
        contentPublished: todayContent,
        deliverablesDue: todayDeliverables,
        campaignsStarting: todayStarting,
        campaignsEnding: todayEnding,
      },
      digest: {
        since: dayAgo.toISOString(),
        contentPublished: digestContent,
        deliverablesCompleted: digestDeliverables,
        campaignsCreated: digestCampaignsCreated,
        campaignsCompleted: digestCampaignsCompleted,
        rosterAdditions: digestRoster,
        contentRemoved: digestRemoved,
        shipmentsDelivered: digestShipmentsDelivered,
        shipmentsFailed: digestShipmentsFailed,
        ugcAwaitingReview: ugcAwaitingReviewCount,
      },
      brands: rollup,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Campaign spend-efficiency (W6-1, fixes ARCH-01). Computes CPV/CPM/CPE, the
   * view/engagement rollups and per-content efficiency **server-side**, plus
   * metric freshness (last sync + stale flag) and provenance (source
   * breakdown). The Web client renders these numbers; it no longer derives
   * them in the browser. A missing input yields null, never a fabricated zero.
   */
  async function campaignEfficiency(idOrSlug: string): Promise<CampaignEfficiencyDTO> {
    const campaign = await prisma.campaign.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: { id: true, brandId: true, currency: true, plannedBudget: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, campaign.brandId)) throw AppError.notFound('Campaign');

    const [cost, contents, roster] = await Promise.all([
      computeCostSummary(ctx, campaign.id, campaign.currency, toMoneyNumber(campaign.plannedBudget)),
      prisma.publishedContent.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          dataSource: true,
          lastMetricsSyncAt: true,
          latestSnapshot: {
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
      }),
      prisma.campaignInfluencer.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          influencerId: true,
          dealType: true,
          agreedCost: true,
          giftedProductValue: true,
          participationStatus: true,
          paymentStatus: true,
          paidAmount: true,
          deliverables: { select: { type: true, status: true, quantity: true } },
          influencer: {
            select: {
              displayName: true,
              avatarOverrideUrl: true,
              resolvedAvatarUrl: true,
              socialAccounts: { where: { isPrimary: true }, select: { avatarUrl: true }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Each creator's own spend against their own posts — the per-post and
    // per-creator cost figures below both come from this.
    const creatorResults = await loadCreatorResults(prisma, campaign.id, roster);
    const rowByInfluencer = new Map(roster.map((r) => [r.influencerId, r.id]));
    const postById = new Map(creatorResults.posts.map((p) => [p.id, p]));

    const totalSpend = cost.totalSpend;
    const contentCount = contents.length;
    const costPerContent = contentCount > 0 ? totalSpend / contentCount : null;

    let views = 0;
    let viewsKnown = false;
    let engagement = 0;
    let engagementKnown = false;
    let erSum = 0;
    let erCount = 0;
    let contentWithMetrics = 0;
    let lastSyncedMs: number | null = null;
    const sourceCounts = new Map<DataSource, number>();
    const perContent: ContentEfficiencyDTO[] = [];

    for (const c of contents) {
      const snap = c.latestSnapshot ?? null;
      const source: DataSource = snap?.source ?? c.dataSource;
      const capturedAt = snap?.capturedAt ?? null;
      const contentEngagement = snap
        ? metrics.totalEngagements({ likes: snap.likes, comments: snap.comments, shares: snap.shares, saves: snap.saves, reposts: snap.reposts })
        : null;

      if (snap) {
        contentWithMetrics += 1;
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      }
      if (snap?.views != null) {
        views += snap.views;
        viewsKnown = true;
      }
      if (contentEngagement != null) {
        engagement += contentEngagement;
        engagementKnown = true;
      }
      if (snap?.engagementRate != null) {
        erSum += snap.engagementRate;
        erCount += 1;
      }
      // Freshness prefers the content's explicit sync stamp, else the snapshot capture.
      const syncedMs = (c.lastMetricsSyncAt ?? capturedAt)?.getTime() ?? null;
      if (syncedMs != null && (lastSyncedMs == null || syncedMs > lastSyncedMs)) lastSyncedMs = syncedMs;

      perContent.push({
        contentId: c.id,
        views: snap?.views ?? null,
        totalEngagement: contentEngagement,
        engagementRate: snap?.engagementRate ?? null,
        // Est. CPV: the creator's own spend shared across their posts ÷ this piece's views.
        costPerView: (() => {
          const post = postById.get(c.id);
          return post ? postCostPerView(post, creatorResults, rowByInfluencer) : null;
        })(),
        source,
        capturedAt: capturedAt ? capturedAt.toISOString() : null,
      });
    }

    const totalViews = viewsKnown ? views : null;
    const totalEngagement = engagementKnown ? engagement : null;
    const metricsLastSyncedAt = lastSyncedMs != null ? new Date(lastSyncedMs).toISOString() : null;
    const now = new Date();

    const sources: MetricSourceCountDTO[] = [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

    return {
      currency: cost.currency,
      totalSpend,
      contentCount,
      contentWithMetrics,
      totalViews,
      totalEngagement,
      avgEngagementRate: erCount > 0 ? erSum / erCount : null,
      costPerView: metrics.costPerView(totalSpend, totalViews),
      costPerMille: metrics.cpm(totalSpend, totalViews),
      costPerEngagement: metrics.costPerEngagement(totalSpend, totalEngagement),
      costPerContent,
      metricsLastSyncedAt,
      isStale: metrics.isMetricsStale(metricsLastSyncedAt, now, METRICS_FRESHNESS_DAYS),
      freshnessWindowDays: METRICS_FRESHNESS_DAYS,
      sources,
      perContent,
      perCreator: roster.map((r) => ({
        campaignInfluencerId: r.id,
        influencerId: r.influencerId,
        influencerName: r.influencer.displayName,
        influencerAvatarUrl:
          r.influencer.avatarOverrideUrl ?? r.influencer.resolvedAvatarUrl ?? r.influencer.socialAccounts[0]?.avatarUrl ?? null,
        ...creatorResults.byRosterRow.get(r.id)!,
      })),
    };
  }

  /**
   * Week- or month-by-month results (P2.7) for the reader's brands, one brand,
   * one campaign or one creator: posts, views, engagements, deliverables
   * delivered and (finance access) payments.
   */
  async function trends(query: TrendsQuery): Promise<TrendsDTO> {
    const scope = await scopedBrandIds(ctx);
    if (query.brandId && isBrandOutOfScope(scope, query.brandId)) throw AppError.notFound('Brand');
    if (query.campaignId) {
      const c = await prisma.campaign.findUnique({ where: { id: query.campaignId }, select: { brandId: true } });
      if (!c || isBrandOutOfScope(scope, c.brandId)) throw AppError.notFound('Campaign');
    }
    const range = defaultTrendRange(query.bucket);
    let fromKey = query.from ?? range.fromKey;
    let toKey = query.to ?? range.toKey;
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
    const canSeeMoney = await hasCapability(ctx, 'FINANCE_VIEW');
    return memo(`trends:${ctx.actor?.id ?? 'system'}:${JSON.stringify(query)}`, () =>
      trendPoints(
        ctx,
        { brandIds: query.brandId ? [query.brandId] : scope, campaignId: query.campaignId, influencerId: query.influencerId },
        fromKey,
        toKey,
        query.bucket,
        canSeeMoney,
      ),
    );
  }

  return {
    creatorLeaderboard: (query: LeaderboardQuery) =>
      memo(`leaderboard:${ctx.actor?.id ?? 'system'}:${JSON.stringify(query)}`, () => creatorLeaderboard(query)),
    executiveDashboard,
    campaignEfficiency,
    trends,
  };
}

export type AnalyticsService = ReturnType<typeof makeAnalyticsService>;
