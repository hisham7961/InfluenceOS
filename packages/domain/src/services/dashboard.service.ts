import type { NotificationCategory } from '@influenceos/database';
import type {
  ActiveCampaignCardDTO,
  ActivityDTO,
  AttentionItemDTO,
  BrandDashboardDTO,
  GlobalDashboardDTO,
  PulseDTO,
  UpcomingContentDTO,
  WhatsNewItemDTO,
  WhatsNewSummaryDTO,
} from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { iso } from '../lib/helpers';
import { moneyNumberOr0, sumMoney } from '../lib/money';
import { toActivityDTO } from '../lib/mappers';
import { scopedBrandIds } from '../lib/scope';
import { makeBrandService } from './brand.service';
import { makeCampaignService } from './campaign.service';
import { makeContentService } from './content.service';

const REMOVED_STATUSES = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;
const OPEN_DELIVERABLE_STATUSES = ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION'] as const;
// Real, already-recorded event categories worth surfacing in "What's New" —
// deliberately excludes GENERAL/SYNC_FAILURE/DELIVERABLE_DUE_SOON/
// CAMPAIGN_ENDING to avoid noise (item 38: this is not an ActivityLog dump).
const WHATS_NEW_CATEGORIES: NotificationCategory[] = [
  'NEW_CONTENT',
  'CONTENT_REMOVED',
  'CONTENT_UNAVAILABLE',
  'DELIVERABLE_OVERDUE',
  'SHIPMENT_DELIVERED',
  'SUBMISSION_APPROVED',
  'USAGE_RIGHT_EXPIRING',
];
const ALERT_CATEGORIES: NotificationCategory[] = ['CONTENT_REMOVED', 'CONTENT_UNAVAILABLE'];

export function makeDashboardService(ctx: DomainContext) {
  const { prisma } = ctx;
  const content = makeContentService(ctx);
  const campaigns = makeCampaignService(ctx);

  const brandFilter = (brandId?: string) => (brandId ? { brandId } : {});

  /** The caller's own "What's New" checkpoint — never lastLoginAt (item 35). */
  async function checkpoint(): Promise<Date | null> {
    const actor = requireActor(ctx);
    const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { lastWhatsNewViewedAt: true } });
    return user?.lastWhatsNewViewedAt ?? null;
  }
  const deliverableBrandFilter = (brandId?: string) =>
    brandId ? { campaignInfluencer: { campaign: { brandId } } } : {};

  async function totalSpend(brandId?: string): Promise<number> {
    const campaignWhere = brandId ? { campaign: { brandId } } : {};
    const [fees, expenses] = await Promise.all([
      prisma.campaignInfluencer.aggregate({
        _sum: { agreedCost: true },
        where: { ...campaignWhere, dealType: { in: ['PAID', 'PAID_PLUS_GIFTED'] } },
      }),
      prisma.campaignExpense.aggregate({
        _sum: { amount: true },
        where: { ...campaignWhere, type: { not: 'GIFT_PRODUCT' } },
      }),
    ]);
    return moneyNumberOr0(sumMoney([fees._sum.agreedCost, expenses._sum.amount]));
  }

  async function pulse(brandId?: string): Promise<PulseDTO> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 864e5);
    const in14 = new Date(now.getTime() + 14 * 864e5);

    const [
      activeCampaigns,
      activeInfluencerRows,
      contentPublishedThisWeek,
      upcomingDeliverables,
      overdueDeliverables,
      spend,
      contentAlerts,
    ] = await Promise.all([
      prisma.campaign.count({ where: { status: 'ACTIVE', ...brandFilter(brandId) } }),
      prisma.campaignInfluencer.findMany({
        where: { campaign: { status: 'ACTIVE', ...(brandId ? { brandId } : {}) } },
        select: { influencerId: true },
        distinct: ['influencerId'],
      }),
      prisma.publishedContent.count({
        where: { detectedAt: { gte: weekAgo }, ...brandFilter(brandId) },
      }),
      prisma.deliverable.count({
        where: {
          dueDate: { gte: now, lte: in14 },
          status: { in: [...OPEN_DELIVERABLE_STATUSES] },
          ...deliverableBrandFilter(brandId),
        },
      }),
      prisma.deliverable.count({
        where: {
          dueDate: { lt: now },
          status: { in: [...OPEN_DELIVERABLE_STATUSES] },
          ...deliverableBrandFilter(brandId),
        },
      }),
      totalSpend(brandId),
      prisma.publishedContent.count({
        where: { availabilityStatus: { in: [...REMOVED_STATUSES] }, ...brandFilter(brandId) },
      }),
    ]);

    return {
      activeCampaigns,
      activeInfluencers: activeInfluencerRows.length,
      contentPublishedThisWeek,
      upcomingDeliverables,
      overdueDeliverables,
      totalSpend: spend,
      currency: 'KWD',
      contentAlerts,
    };
  }

  /**
   * "Since your last visit" (Content Command Center pass) — driven by the
   * caller's own lastWhatsNewViewedAt checkpoint, NEVER lastLoginAt (a user
   * can log in without ever opening this panel — item 35) and never just
   * "the most recent N items" (item 34). A user who has never acknowledged
   * What's New sees the last 7 days, a sane bound rather than their entire
   * history.
   */
  async function whatsNewSince(): Promise<Date> {
    const since = await checkpoint();
    return since ?? new Date(Date.now() - 7 * 864e5);
  }

  async function whatsNew(brandId?: string, limit = 14): Promise<WhatsNewItemDTO[]> {
    const since = await whatsNewSince();
    const scope = await scopedBrandIds(ctx);
    const scopeWhere = scope ? { brandId: { in: scope } } : {};
    const recentContent = await prisma.publishedContent.findMany({
      where: { ...scopeWhere, ...brandFilter(brandId), detectedAt: { gt: since } },
      include: content.relIncludeFor(ctx.actor?.id),
      orderBy: [{ detectedAt: 'desc' }],
      take: limit,
    });
    const items: WhatsNewItemDTO[] = recentContent.map((pc) => {
      const dto = content.mapRow(pc);
      return {
        id: `content-${pc.id}`,
        kind: 'CONTENT_PUBLISHED',
        at: dto.detectedAt,
        content: dto,
        title: dto.influencer?.displayName ?? `${pc.platform} content`,
        subtitle: dto.campaign?.name ?? null,
        link: `/content/${pc.id}`,
      };
    });
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  }

  /** Advance the caller's own checkpoint — called explicitly when the client acknowledges What's New, never as a GET side effect. */
  async function whatsNewAck(): Promise<string> {
    const actor = requireActor(ctx);
    const now = new Date();
    await prisma.user.update({ where: { id: actor.id }, data: { lastWhatsNewViewedAt: now } });
    return now.toISOString();
  }

  async function whatsNewSummary(brandId?: string): Promise<WhatsNewSummaryDTO> {
    const since = await checkpoint();
    const effectiveSince = since ?? new Date(Date.now() - 7 * 864e5);
    const scope = await scopedBrandIds(ctx);
    const scopeWhere = scope ? { brandId: { in: scope } } : {};
    const brandWhere = brandFilter(brandId);
    const notifWhere = { ...scopeWhere, ...brandWhere, createdAt: { gt: effectiveSince } };

    const [items, newContent, campaignsLaunched, byCategory, byBrandRows, brands] = await Promise.all([
      whatsNew(brandId, 20),
      prisma.publishedContent.count({ where: { ...scopeWhere, ...brandWhere, detectedAt: { gt: effectiveSince } } }),
      prisma.campaign.count({ where: { ...scopeWhere, ...brandWhere, status: 'ACTIVE', createdAt: { gt: effectiveSince } } }),
      prisma.notification.groupBy({
        by: ['category'],
        where: { ...notifWhere, category: { in: WHATS_NEW_CATEGORIES } },
        _count: true,
      }),
      prisma.notification.groupBy({
        by: ['brandId', 'category'],
        where: { ...scopeWhere, createdAt: { gt: effectiveSince }, brandId: { not: null }, category: { in: WHATS_NEW_CATEGORIES } },
        _count: true,
      }),
      prisma.brand.findMany({ where: scope ? { id: { in: scope } } : {}, select: { id: true, name: true } }),
    ]);

    const countFor = (cats: NotificationCategory[]) =>
      byCategory.filter((r) => cats.includes(r.category)).reduce((sum, r) => sum + r._count, 0);

    const brandNames = new Map(brands.map((b) => [b.id, b.name]));
    const byBrandMap = new Map<string, { updates: number; newContent: number; alerts: number }>();
    for (const row of byBrandRows) {
      if (!row.brandId) continue;
      const entry = byBrandMap.get(row.brandId) ?? { updates: 0, newContent: 0, alerts: 0 };
      entry.updates += row._count;
      if (row.category === 'NEW_CONTENT') entry.newContent += row._count;
      if (ALERT_CATEGORIES.includes(row.category)) entry.alerts += row._count;
      byBrandMap.set(row.brandId, entry);
    }

    return {
      since: iso(since),
      newContent,
      campaignsLaunched,
      contentAlerts: countFor(ALERT_CATEGORIES),
      overdueDeliverables: countFor(['DELIVERABLE_OVERDUE']),
      shipmentsDelivered: countFor(['SHIPMENT_DELIVERED']),
      submissionsApproved: countFor(['SUBMISSION_APPROVED']),
      usageRightsExpiring: countFor(['USAGE_RIGHT_EXPIRING']),
      items,
      byBrand: Array.from(byBrandMap.entries())
        .map(([brandId_, v]) => ({ brandId: brandId_, brandName: brandNames.get(brandId_) ?? 'Unknown brand', ...v }))
        .sort((a, b) => b.updates - a.updates),
    };
  }

  /** Combines the actor's own brand scope (W4-4) with an optional explicit brandId filter — a brand-scoped user must never see another brand's attention items on their OWN (unscoped-call) Mission Control. */
  async function attentionBrandFilter(brandId?: string): Promise<{ brandId?: string | { in: string[] } }> {
    if (brandId) return { brandId };
    const scope = await scopedBrandIds(ctx);
    return scope ? { brandId: { in: scope } } : {};
  }

  /**
   * The ONE canonical operational-attention source (Operations Intelligence
   * pass, PART 55) — Mission Control, the Campaign/Creator contextual views
   * and the Operations page all render a brandId/campaignId/influencerId-
   * filtered slice of this SAME list, never a second calculation.
   */
  async function attention(brandId?: string, limit = 12): Promise<AttentionItemDTO[]> {
    const now = new Date();
    const in5 = new Date(now.getTime() + 5 * 864e5);
    const in14 = new Date(now.getTime() + 14 * 864e5);
    const out: AttentionItemDTO[] = [];

    const bf = await attentionBrandFilter(brandId);
    const deliverableBf = bf.brandId ? { campaignInfluencer: { campaign: { brandId: bf.brandId } } } : {};
    const shipmentBf = bf.brandId ? { campaignInfluencer: { campaign: { brandId: bf.brandId } } } : {};

    const [overdue, removed, endingSoon, unassignedCount, shipmentIssues, expiringRights, ownerlessCount, ugcAwaiting] =
      await Promise.all([
        prisma.deliverable.findMany({
          where: { dueDate: { lt: now }, status: { in: [...OPEN_DELIVERABLE_STATUSES] }, ...deliverableBf },
          include: {
            campaignInfluencer: {
              select: { campaignId: true, influencer: { select: { displayName: true } }, campaign: { select: { name: true, brandId: true } } },
            },
          },
          orderBy: { dueDate: 'asc' },
          take: limit,
        }),
        prisma.publishedContent.findMany({
          where: { availabilityStatus: { in: [...REMOVED_STATUSES] }, ...bf },
          include: { influencer: { select: { displayName: true } } },
          orderBy: { lastCheckedAt: 'desc' },
          take: limit,
        }),
        prisma.campaign.findMany({
          where: { status: 'ACTIVE', endDate: { gte: now, lte: in5 }, ...bf },
          orderBy: { endDate: 'asc' },
          take: limit,
        }),
        // Content Command Center pass — reuses the SAME "no campaign, no
        // influencer" derivation as everywhere else (never a stored column),
        // one roll-up entry rather than a row per item.
        prisma.publishedContent.count({ where: { campaignId: null, influencerId: null, ...bf } }),
        prisma.productShipment.findMany({
          where: { status: { in: ['FAILED', 'RETURNED'] }, ...shipmentBf },
          include: {
            campaignInfluencer: {
              select: { campaignId: true, influencer: { select: { displayName: true } }, campaign: { select: { name: true, brandId: true } } },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        }),
        prisma.usageRight.findMany({
          where: { status: 'ACTIVE', expiresAt: { gte: now, lte: in14 }, ...bf },
          include: { brand: { select: { name: true } } },
          orderBy: { expiresAt: 'asc' },
          take: limit,
        }),
        prisma.campaign.count({ where: { ownerId: null, status: { in: ['ACTIVE', 'PLANNING'] }, ...bf } }),
        prisma.deliverableSubmission.findMany({
          where: { status: 'IN_REVIEW', deliverable: { campaignInfluencer: { campaign: bf.brandId ? { brandId: bf.brandId } : {} } } },
          include: {
            deliverable: {
              select: {
                campaignInfluencer: {
                  select: { campaignId: true, influencer: { select: { displayName: true } }, campaign: { select: { name: true, brandId: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: limit,
        }),
      ]);

    for (const d of overdue) {
      out.push({
        id: `overdue-${d.id}`,
        kind: 'DELIVERABLE_OVERDUE',
        title: `Deliverable overdue — ${d.campaignInfluencer.influencer.displayName}`,
        description: `A ${d.type.toLowerCase()} for ${d.campaignInfluencer.campaign.name} passed its due date.`,
        severity: 'danger',
        link: `/campaigns/${d.campaignInfluencer.campaignId}`,
        at: (d.dueDate ?? d.createdAt).toISOString(),
        brandId: d.campaignInfluencer.campaign.brandId,
        campaignId: d.campaignInfluencer.campaignId,
        influencerId: null,
        actionLabel: 'Open deliverable',
      });
    }
    for (const c of removed) {
      out.push({
        id: `removed-${c.id}`,
        kind: c.availabilityStatus === 'REMOVED' ? 'CONTENT_REMOVED' : 'CONTENT_UNAVAILABLE',
        title: `Content ${c.availabilityStatus.toLowerCase()}`,
        description: `A ${c.platform} post${c.influencer ? ` by ${c.influencer.displayName}` : ''} is ${c.availabilityStatus.toLowerCase()}.`,
        severity: 'warning',
        link: `/content/${c.id}`,
        at: (c.lastCheckedAt ?? c.detectedAt).toISOString(),
        brandId: c.brandId,
        campaignId: c.campaignId,
        influencerId: c.influencerId,
        actionLabel: 'Review content',
      });
    }
    for (const c of endingSoon) {
      out.push({
        id: `ending-${c.id}`,
        kind: 'CAMPAIGN_ENDING',
        title: `${c.name} ends soon`,
        description: `This campaign ends on ${c.endDate?.toISOString().slice(0, 10)}.`,
        severity: 'warning',
        link: `/campaigns/${c.id}`,
        at: (c.endDate ?? now).toISOString(),
        brandId: c.brandId,
        campaignId: c.id,
        influencerId: null,
        actionLabel: 'Open campaign',
      });
    }
    for (const s of shipmentIssues) {
      const failed = s.status === 'FAILED';
      out.push({
        id: `shipment-${s.id}`,
        kind: failed ? 'SHIPMENT_FAILED' : 'SHIPMENT_RETURNED',
        title: `Shipment ${failed ? 'failed' : 'returned'} — ${s.campaignInfluencer.influencer.displayName}`,
        description: `A shipment for ${s.campaignInfluencer.campaign.name} was ${failed ? 'marked failed' : 'returned'}.`,
        severity: 'danger',
        link: `/campaigns/${s.campaignInfluencer.campaignId}?tab=shipments`,
        at: s.updatedAt.toISOString(),
        brandId: s.campaignInfluencer.campaign.brandId,
        campaignId: s.campaignInfluencer.campaignId,
        influencerId: null,
        actionLabel: 'Resolve shipment',
      });
    }
    for (const r of expiringRights) {
      out.push({
        id: `usage-right-${r.id}`,
        kind: 'USAGE_RIGHT_EXPIRING',
        title: `Usage right expiring — ${r.brand.name}`,
        description: `A ${r.usageType.toLowerCase()} usage right expires on ${r.expiresAt?.toISOString().slice(0, 10)}.`,
        severity: 'warning',
        link: `/brands/${r.brandId}`,
        at: (r.expiresAt ?? now).toISOString(),
        brandId: r.brandId,
        campaignId: r.campaignId,
        influencerId: r.influencerId,
        actionLabel: 'Review usage right',
      });
    }
    for (const s of ugcAwaiting) {
      const ci = s.deliverable.campaignInfluencer;
      out.push({
        id: `ugc-${s.id}`,
        kind: 'UGC_AWAITING_REVIEW',
        title: `Draft awaiting review — ${ci.influencer.displayName}`,
        description: `A submission for ${ci.campaign.name} has been waiting for review.`,
        severity: 'warning',
        link: `/campaigns/${ci.campaignId}?tab=submissions`,
        at: now.toISOString(),
        brandId: ci.campaign.brandId,
        campaignId: ci.campaignId,
        influencerId: null,
        actionLabel: 'Review draft',
      });
    }

    if (unassignedCount > 0) {
      out.push({
        id: 'unassigned-content',
        kind: 'UNASSIGNED_CONTENT',
        title: `${unassignedCount} unassigned content item${unassignedCount === 1 ? '' : 's'}`,
        description: 'Published content with no campaign or influencer linked yet — resolve it from the content wall.',
        severity: 'warning',
        link: '/content?assignment=UNASSIGNED',
        at: now.toISOString(),
        brandId: brandId ?? null,
        campaignId: null,
        influencerId: null,
        actionLabel: 'Resolve content',
      });
    }
    if (ownerlessCount > 0) {
      out.push({
        id: 'campaigns-missing-owner',
        kind: 'CAMPAIGN_MISSING_OWNER',
        title: `${ownerlessCount} campaign${ownerlessCount === 1 ? '' : 's'} missing an owner`,
        description: 'Active or planning campaigns with no assigned owner.',
        severity: 'warning',
        link: '/campaigns?ownerMissing=1',
        at: now.toISOString(),
        brandId: brandId ?? null,
        campaignId: null,
        influencerId: null,
        actionLabel: 'Assign owner',
      });
    }

    const severityRank = (s: string) => (s === 'danger' ? 0 : 1);
    return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, limit);
  }

  async function activeCampaignCards(brandId?: string, limit = 6): Promise<ActiveCampaignCardDTO[]> {
    const result = await campaigns.list({
      page: 1,
      pageSize: limit,
      order: 'desc',
      ...(brandId ? { brandId } : {}),
      status: 'ACTIVE',
    } as Parameters<typeof campaigns.list>[0]);
    return result.data.map((campaign) => ({ campaign }));
  }

  async function upcomingContent(brandId?: string, limit = 8): Promise<UpcomingContentDTO[]> {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 864e5);
    const rows = await prisma.campaignInfluencer.findMany({
      where: {
        expectedPublishAt: { gte: now, lte: in14 },
        ...(brandId ? { campaign: { brandId } } : {}),
      },
      include: {
        influencer: { select: { displayName: true, primaryPlatform: true, avatarOverrideUrl: true, resolvedAvatarUrl: true } },
        campaign: { select: { name: true, brand: { select: { name: true } } } },
        deliverables: { select: { platform: true }, take: 1 },
      },
      orderBy: { expectedPublishAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      influencerName: r.influencer.displayName,
      influencerAvatarUrl: r.influencer.avatarOverrideUrl ?? r.influencer.resolvedAvatarUrl ?? null,
      platform: r.deliverables[0]?.platform ?? r.influencer.primaryPlatform ?? 'INSTAGRAM',
      campaignName: r.campaign.name,
      brandName: r.campaign.brand.name,
      expectedAt: (r.expectedPublishAt ?? now).toISOString(),
    }));
  }

  async function recentActivity(brandId?: string, limit = 10): Promise<ActivityDTO[]> {
    const rows = await prisma.activityLog.findMany({
      where: brandId ? { brandId } : {},
      include: { actor: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toActivityDTO);
  }

  async function global(brandId?: string): Promise<GlobalDashboardDTO> {
    const [pulseData, whatsNewData, whatsNewSummaryData, attentionData, activeData, upcomingData, activityData, contentSummaryData] =
      await Promise.all([
        pulse(brandId),
        whatsNew(brandId),
        whatsNewSummary(brandId),
        attention(brandId),
        activeCampaignCards(brandId),
        upcomingContent(brandId),
        recentActivity(brandId),
        // Reused for the "Review New Content" CTA's count — same
        // GET /content/summary aggregation, not a second computation.
        content.summary({}),
      ]);
    return {
      pulse: pulseData,
      whatsNew: whatsNewData,
      whatsNewSummary: whatsNewSummaryData,
      attention: attentionData,
      activeCampaigns: activeData,
      upcomingContent: upcomingData,
      recentActivity: activityData,
      contentSummary: contentSummaryData,
    };
  }

  async function brand(idOrSlug: string): Promise<BrandDashboardDTO> {
    const brandSvc = makeBrandService(ctx);
    const detail = await brandSvc.detail(idOrSlug);
    const dash = await global(detail.id);
    return { ...dash, brand: detail };
  }

  return { global, brand, pulse, whatsNew, whatsNewSummary, whatsNewAck, attention };
}

export type DashboardService = ReturnType<typeof makeDashboardService>;
