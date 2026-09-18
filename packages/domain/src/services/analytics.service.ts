import {
  requests,
  type CreatorLeaderboardDTO,
  type CreatorTier,
  type ExecBrandRollupDTO,
  type ExecDashboardDTO,
  type LeaderboardEntryDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { moneyNumberOr0, percentOf, sumMoney, toDecimal } from '../lib/money';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';

type LeaderboardQuery = z.infer<typeof requests.leaderboardQuerySchema>;
type ExecDashboardQuery = z.infer<typeof requests.execDashboardQuerySchema>;

// Deliverables not yet delivered (open) — the set that can be overdue or due today.
const OPEN_DELIVERABLE = ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION'] as const;
// Content that has left the feed (a brand-health alert).
const REMOVED_CONTENT = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;
// Deals that carry an influencer fee (gift-only deals contribute no spend).
const PAID_DEALS = ['PAID', 'PAID_PLUS_GIFTED'] as const;

// A collaboration only counts once committed — an invited/declined/dropped
// participation never inflates a creator's standing (consistent with DB-10).
const COMMITTED = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;
// A deliverable counts as delivered once it reaches a published/verified/
// approved state (UGC completes via approval, W3-1).
const PUBLISHED = ['PUBLISHED', 'VERIFIED', 'APPROVED'] as const;

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
        paymentStatus: true,
        influencer: {
          select: { displayName: true, primaryUsername: true, category: true, avatarOverrideUrl: true, resolvedAvatarUrl: true },
        },
        campaign: { select: { brandId: true } },
        deliverables: { select: { status: true } },
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
      acc.deliverablesTotal += r.deliverables.length;
      acc.deliverablesPublished += r.deliverables.filter((d) => (PUBLISHED as readonly string[]).includes(d.status)).length;
      if ((r.dealType === 'PAID' || r.dealType === 'PAID_PLUS_GIFTED') && r.paymentStatus === 'PAID' && r.agreedCost != null) {
        acc.paid.push(new Prisma.Decimal(r.agreedCost));
      }
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
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfToday = new Date(startOfToday.getTime() + 864e5);
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

    // Per-campaign spend in two grouped queries (never a per-campaign fan-out).
    const [feeGroups, expGroups] = campaignIds.length
      ? await Promise.all([
          prisma.campaignInfluencer.groupBy({ by: ['campaignId'], _sum: { agreedCost: true }, where: { campaignId: { in: campaignIds }, dealType: { in: [...PAID_DEALS] } } }),
          prisma.campaignExpense.groupBy({ by: ['campaignId'], _sum: { amount: true }, where: { campaignId: { in: campaignIds }, type: { not: 'GIFT_PRODUCT' } } }),
        ])
      : [[], []];
    const feeByCampaign = new Map(feeGroups.map((g) => [g.campaignId, g._sum.agreedCost]));
    const expByCampaign = new Map(expGroups.map((g) => [g.campaignId, g._sum.amount]));

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
    ] = await Promise.all([
      prisma.publishedContent.count({ where: { detectedAt: { gte: startOfToday, lt: endOfToday }, ...pcBrand } }),
      prisma.deliverable.count({ where: { dueDate: { gte: startOfToday, lt: endOfToday }, status: { in: [...OPEN_DELIVERABLE] }, ...delBrand } }),
      prisma.campaign.count({ where: { startDate: { gte: startOfToday, lt: endOfToday }, ...campBrand } }),
      prisma.campaign.count({ where: { endDate: { gte: startOfToday, lt: endOfToday }, ...campBrand } }),
      prisma.publishedContent.count({ where: { detectedAt: { gte: dayAgo }, ...pcBrand } }),
      prisma.deliverable.count({ where: { status: { in: ['PUBLISHED', 'VERIFIED', 'APPROVED'] }, updatedAt: { gte: dayAgo }, ...delBrand } }),
      prisma.campaign.count({ where: { createdAt: { gte: dayAgo }, ...campBrand } }),
      prisma.campaign.count({ where: { status: 'COMPLETED', updatedAt: { gte: dayAgo }, ...campBrand } }),
      prisma.campaignInfluencer.count({ where: { createdAt: { gte: dayAgo }, ...ciBrand } }),
      prisma.publishedContent.count({ where: { availabilityStatus: { in: [...REMOVED_CONTENT] }, lastCheckedAt: { gte: dayAgo }, ...pcBrand } }),
      prisma.deliverable.findMany({
        where: { dueDate: { lt: now }, status: { in: [...OPEN_DELIVERABLE] }, ...delBrand },
        select: { campaignInfluencer: { select: { campaign: { select: { brandId: true } } } } },
      }),
      prisma.publishedContent.groupBy({ by: ['brandId'], _count: true, where: inBrands({ availabilityStatus: { in: [...REMOVED_CONTENT] } }) }),
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
      const spend = sumMoney([feeByCampaign.get(c.id), expByCampaign.get(c.id)]);
      totalBudget = totalBudget.plus(budget);
      totalSpend = totalSpend.plus(spend);
      if (budget.gt(0) && spend.gt(budget)) campaignsOverBudget += 1;
      if (c.status === 'ACTIVE') activeByBrand.set(c.brandId, (activeByBrand.get(c.brandId) ?? 0) + 1);
      budgetByBrand.set(c.brandId, (budgetByBrand.get(c.brandId) ?? new Prisma.Decimal(0)).plus(budget));
      spendByBrand.set(c.brandId, (spendByBrand.get(c.brandId) ?? new Prisma.Decimal(0)).plus(spend));
    }

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
      },
      brands: rollup,
      generatedAt: now.toISOString(),
    };
  }

  return { creatorLeaderboard, executiveDashboard };
}

export type AnalyticsService = ReturnType<typeof makeAnalyticsService>;
