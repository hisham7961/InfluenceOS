import { METRICS_FRESHNESS_DAYS, businessToday, isDeliverableDelivered, metrics } from '@influenceos/shared';
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

type LeaderboardQuery = z.infer<typeof requests.leaderboardQuerySchema>;
type ExecDashboardQuery = z.infer<typeof requests.execDashboardQuerySchema>;

// Content that has left the feed (a brand-health alert).
const REMOVED_CONTENT = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;

// A collaboration only counts once committed — an invited/declined/dropped
// participation never inflates a creator's standing (consistent with DB-10).
const COMMITTED = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

/** Deterministic performance score and tier from delivered work (W6-2). */
function tierFor(published: number): CreatorTier {
  if (published >= 8) return 'GOLD';
  if (published >= 3) return 'SILVER';
  if (published >= 1) return 'BRONZE';
  return 'NEW';
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
        deliverables: { select: { status: true, type: true } },
      },
      take: 5000,
    });

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
        };
        byInfluencer.set(r.influencerId, acc);
      }
      acc.campaigns += 1;
      acc.brands.add(r.campaign.brandId);
      const planned = r.deliverables.filter((d) => d.status !== 'CANCELLED');
      acc.deliverablesTotal += planned.length;
      acc.deliverablesPublished += planned.filter(isDeliverableDelivered).length;
      // Part payments count as paid too (what was actually paid).
      const paidPart = participationMoney(r).paid;
      if (paidPart.gt(0)) acc.paid.push(paidPart);
    }

    const entries: LeaderboardEntryDTO[] = [...byInfluencer.values()].map((a) => {
      const repeatCollaborations = Math.max(0, a.campaigns - 1);
      const score = a.deliverablesPublished * 10 + a.campaigns * 5 + repeatCollaborations * 3;
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
        tier: tierFor(a.deliverablesPublished),
        score,
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
      prisma.campaign.findMany({ where: campBrand, select: { id: true, brandId: true, status: true, plannedBudget: true } }),
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

    // Aggregate spend / budget, per brand and overall, from the grouped rows.
    let totalBudget = new Prisma.Decimal(0);
    let totalSpend = new Prisma.Decimal(0);
    let campaignsOverBudget = 0;
    const activeByBrand = new Map<string, number>();
    const budgetByBrand = new Map<string, Prisma.Decimal>();
    const spendByBrand = new Map<string, Prisma.Decimal>();
    for (const c of campaigns) {
      const budget = toDecimal(c.plannedBudget) ?? new Prisma.Decimal(0);
      const spend = (moneyByCampaign.get(c.id) ?? EMPTY_CAMPAIGN_MONEY).totalSpend;
      totalBudget = totalBudget.plus(budget);
      totalSpend = totalSpend.plus(spend);
      if (budget.gt(0) && spend.gt(budget)) campaignsOverBudget += 1;
      if (c.status === 'ACTIVE') activeByBrand.set(c.brandId, (activeByBrand.get(c.brandId) ?? 0) + 1);
      budgetByBrand.set(c.brandId, (budgetByBrand.get(c.brandId) ?? new Prisma.Decimal(0)).plus(budget));
      spendByBrand.set(c.brandId, (spendByBrand.get(c.brandId) ?? new Prisma.Decimal(0)).plus(spend));
    }

    // Outstanding = everything still owed on these campaigns, part payments
    // counted for what's left (same rule as each campaign's cost summary).
    const unpaidSpend = sumCampaignMoney(moneyByCampaign.values(), 'unpaid');

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
      const budget = budgetByBrand.get(b.id) ?? new Prisma.Decimal(0);
      const spend = spendByBrand.get(b.id) ?? new Prisma.Decimal(0);
      const overBudget = budget.gt(0) && spend.gt(budget);
      const overdueDeliverables = overdueByBrand.get(b.id) ?? 0;
      const contentAlerts = alertsByBrand.get(b.id) ?? 0;
      return {
        brandId: b.id,
        brandName: b.name,
        slug: b.slug,
        activeCampaigns: activeByBrand.get(b.id) ?? 0,
        totalSpend: moneyNumberOr0(spend),
        plannedBudget: moneyNumberOr0(budget),
        budgetUsedPercent: percentOf(spend, budget),
        overBudget,
        overdueDeliverables,
        contentAlerts,
        issueCount: overdueDeliverables + contentAlerts + (overBudget ? 1 : 0),
      };
    });
    rollup.sort((a, b) => b.issueCount - a.issueCount || b.totalSpend - a.totalSpend || a.brandName.localeCompare(b.brandName));

    return {
      currency: 'KWD',
      spendVsBudget: {
        currency: 'KWD',
        plannedBudget: moneyNumberOr0(totalBudget),
        totalSpend: moneyNumberOr0(totalSpend),
        remaining: totalBudget.minus(totalSpend).toNumber(),
        budgetUsedPercent: percentOf(totalSpend, totalBudget),
        campaignsOverBudget,
        unpaidSpend: moneyNumberOr0(unpaidSpend),
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
      const snap = c.metricSnapshots[0] ?? null;
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

  return { creatorLeaderboard, executiveDashboard, campaignEfficiency };
}

export type AnalyticsService = ReturnType<typeof makeAnalyticsService>;
