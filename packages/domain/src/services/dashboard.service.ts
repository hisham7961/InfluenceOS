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
import { LOGISTICS_ISSUE_TYPE_LABELS, appRoutes } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { iso } from '../lib/helpers';
import { moneyNumberOr0 } from '../lib/money';
import { dueWithinWhere, overdueWhere } from '../lib/deliverable-rules';
import { loadCampaignMoney, sumCampaignMoney } from '../lib/spend';
import { toActivityDTO } from '../lib/mappers';
import { scopedBrandIds } from '../lib/scope';
import { makeBrandService } from './brand.service';
import { makeCampaignService } from './campaign.service';
import { makeContentService } from './content.service';
import { makeLicenceService } from './licence.service';

const REMOVED_STATUSES = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;
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

  // Security & Authorization Freeze Gate (aggregate-leak-audit) — composes
  // an explicit brandId with the actor's own brand scope, same posture as
  // campaign.service.ts's buildWhere(): an out-of-scope explicit brandId
  // matches nothing rather than silently widening; an unscoped actor
  // (ADMIN, or no explicit UserBrandAccess rows) is untouched. Used by
  // every Mission Control aggregate below (pulse/totalSpend/upcomingContent/
  // recentActivity) so a brand-scoped actor's OWN /dashboard/global call
  // (no explicit brandId — there is no capability gate on that route; any
  // authenticated actor can call it) never rolls up another brand's spend,
  // activity or content — mirrors whatsNew/whatsNewSummary/attention in this
  // same file, which already composed scope before this fix.
  async function scopedBrandFilter(
    brandId?: string,
  ): Promise<{ brandId?: string | { in: string[] } }> {
    const scope = await scopedBrandIds(ctx);
    if (brandId) return { brandId: scope && !scope.includes(brandId) ? { in: [] } : brandId };
    return scope ? { brandId: { in: scope } } : {};
  }

  /** The caller's own "What's New" checkpoint — never lastLoginAt (item 35). */
  async function checkpoint(): Promise<Date | null> {
    const actor = requireActor(ctx);
    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { lastWhatsNewViewedAt: true },
    });
    return user?.lastWhatsNewViewedAt ?? null;
  }
  /** Deliverable-relation variant of scopedBrandFilter — a Deliverable's
   *  brand lives at campaignInfluencer.campaign.brandId, not on the row itself. */
  async function scopedDeliverableBrandFilter(
    brandId?: string,
  ): Promise<{ campaignInfluencer?: { campaign: { brandId: string | { in: string[] } } } }> {
    const bf = await scopedBrandFilter(brandId);
    return bf.brandId !== undefined
      ? { campaignInfluencer: { campaign: { brandId: bf.brandId } } }
      : {};
  }

  async function totalSpend(brandId?: string): Promise<number> {
    const bf = await scopedBrandFilter(brandId);
    const campaigns = await prisma.campaign.findMany({
      where: bf.brandId !== undefined ? { brandId: bf.brandId } : {},
      select: { id: true },
    });
    const money = await loadCampaignMoney(
      prisma,
      campaigns.map((c) => c.id),
    );
    return moneyNumberOr0(sumCampaignMoney(money.values(), 'totalSpend'));
  }

  async function pulse(brandId?: string): Promise<PulseDTO> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 864e5);

    // Brand scope (Security & Authorization Freeze Gate, aggregate-leak-
    // audit) — pulse() backs the Mission Control "at a glance" KPIs and is
    // reachable via /dashboard/global with no capability gate, only
    // requireAuth; without this every count here (active campaigns/
    // influencers, spend, overdue deliverables, content alerts) rolled up
    // EVERY brand for any authenticated brand-scoped actor who simply
    // omitted the optional brandId query param.
    const bf = await scopedBrandFilter(brandId);
    const dbf = await scopedDeliverableBrandFilter(brandId);

    const [
      activeCampaigns,
      activeInfluencerRows,
      contentPublishedThisWeek,
      upcomingDeliverables,
      overdueDeliverables,
      spend,
      contentAlerts,
    ] = await Promise.all([
      prisma.campaign.count({ where: { status: 'ACTIVE', ...bf } }),
      prisma.campaignInfluencer.findMany({
        where: {
          campaign: {
            status: 'ACTIVE',
            ...(bf.brandId !== undefined ? { brandId: bf.brandId } : {}),
          },
        },
        select: { influencerId: true },
        distinct: ['influencerId'],
      }),
      prisma.publishedContent.count({
        where: { detectedAt: { gte: weekAgo }, ...bf },
      }),
      prisma.deliverable.count({ where: { AND: [dueWithinWhere(14, now), dbf] } }),
      prisma.deliverable.count({ where: { AND: [overdueWhere(now), dbf] } }),
      totalSpend(brandId),
      prisma.publishedContent.count({
        where: { availabilityStatus: { in: [...REMOVED_STATUSES] }, ...bf },
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
    // FIX (aggregate-leak-audit): previously `{ ...scopeWhere, ...brandFilter(brandId) }`
    // — when an explicit brandId was passed, its flat `{ brandId }` spread
    // AFTER scopeWhere silently overwrote scopeWhere's `{ brandId: { in:
    // scope } } }` (same object key, last one wins), so a scoped actor could
    // pass an explicit OUT-OF-SCOPE brandId and see that brand's What's New
    // content in full — the exact opposite of "an out-of-scope explicit
    // filter matches nothing" every other buildWhere() in this codebase
    // guarantees. scopedBrandFilter() composes the two correctly instead.
    const bf = await scopedBrandFilter(brandId);
    const recentContent = await prisma.publishedContent.findMany({
      where: { ...bf, detectedAt: { gt: since } },
      include: content.relIncludeFor(ctx.actor?.id),
      orderBy: [{ detectedAt: 'desc' }],
      take: limit,
    });
    const items: WhatsNewItemDTO[] = await Promise.all(
      recentContent.map(async (pc) => {
        const dto = await content.mapRow(pc);
        return {
          id: `content-${pc.id}`,
          kind: 'CONTENT_PUBLISHED' as const,
          at: dto.detectedAt,
          content: dto,
          title: dto.influencer?.displayName ?? `${pc.platform} content`,
          subtitle: dto.campaign?.name ?? null,
          link: `/content/${pc.id}`,
        };
      }),
    );
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
    // FIX (aggregate-leak-audit) — same overwrite hazard whatsNew() had: an
    // explicit brandId must be checked AGAINST scope, never flat-merged after
    // it (last key wins on a plain object spread). bf is the correctly
    // composed filter; the cross-brand `byBrandRows`/`brands` rollup below
    // intentionally still uses the broader scopeWhere (not bf) — that
    // rollup's own job is "every in-scope brand's activity", independent of
    // whichever single brand the caller's own view is currently narrowed to.
    const bf = await scopedBrandFilter(brandId);
    const notifWhere = { ...bf, createdAt: { gt: effectiveSince } };

    const [items, newContent, campaignsLaunched, byCategory, byBrandRows, brands] =
      await Promise.all([
        whatsNew(brandId, 20),
        prisma.publishedContent.count({ where: { ...bf, detectedAt: { gt: effectiveSince } } }),
        prisma.campaign.count({
          where: { ...bf, status: 'ACTIVE', createdAt: { gt: effectiveSince } },
        }),
        prisma.notification.groupBy({
          by: ['category'],
          where: { ...notifWhere, category: { in: WHATS_NEW_CATEGORIES } },
          _count: true,
        }),
        prisma.notification.groupBy({
          by: ['brandId', 'category'],
          where: {
            ...scopeWhere,
            createdAt: { gt: effectiveSince },
            brandId: { not: null },
            category: { in: WHATS_NEW_CATEGORIES },
          },
          _count: true,
        }),
        prisma.brand.findMany({
          where: scope ? { id: { in: scope } } : {},
          select: { id: true, name: true },
        }),
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
        .map(([brandId_, v]) => ({
          brandId: brandId_,
          brandName: brandNames.get(brandId_) ?? 'Unknown brand',
          ...v,
        }))
        .sort((a, b) => b.updates - a.updates),
    };
  }

  /** Combines the actor's own brand scope (W4-4) with an optional explicit
   *  brandId filter — a brand-scoped user must never see another brand's
   *  attention items on their OWN (unscoped-call) Mission Control.
   *
   *  FIX (aggregate-leak-audit): this used to `return { brandId }`
   *  immediately whenever an explicit brandId was passed, WITHOUT checking
   *  it against the actor's scope at all — a brand-scoped actor could pass
   *  any brandId (in or out of their scope) to /dashboard/attention and see
   *  that brand's overdue deliverables, failed shipments, removed content,
   *  expiring usage rights etc. in full. Delegating to scopedBrandFilter()
   *  gives the same "out-of-scope explicit filter matches nothing" guarantee
   *  every other buildWhere() in this codebase already has. */
  async function attentionBrandFilter(
    brandId?: string,
  ): Promise<{ brandId?: string | { in: string[] } }> {
    return scopedBrandFilter(brandId);
  }

  /**
   * The ONE canonical operational-attention source (Operations Intelligence
   * pass, PART 55). Mission Control renders a brandId-filtered slice
   * directly (via `global()`); the Campaign Operations Board renders a
   * campaignId-filtered slice via the same function (never a second
   * calculation of these item kinds) alongside its own per-row derived
   * stage state, which answers a different question ("where is THIS
   * CampaignInfluencer's progress") than this list does ("what across the
   * system needs a human to act"). The Executive Brief intentionally does
   * NOT source its KPI digest from here — those are unlimited aggregate
   * counts computed by analytics.service.ts, whereas this list is capped at
   * `limit` and item-shaped; forcing the digest through this capped list
   * would silently undercount at scale.
   */
  async function attention(
    brandId?: string,
    campaignId?: string,
    limit = 12,
  ): Promise<AttentionItemDTO[]> {
    const now = new Date();
    const in5 = new Date(now.getTime() + 5 * 864e5);
    const in14 = new Date(now.getTime() + 14 * 864e5);
    const out: AttentionItemDTO[] = [];

    const bf = await attentionBrandFilter(brandId);
    // campaignId narrows further within whatever brand scope already applies
    // (never a way to escape it) — a scoped user passing a campaignId from
    // another brand simply gets zero rows, same as any other out-of-scope
    // filter in this codebase.
    const ciFilter = {
      ...(bf.brandId ? { campaign: { brandId: bf.brandId } } : {}),
      ...(campaignId ? { campaignId } : {}),
    };
    const deliverableBf = Object.keys(ciFilter).length ? { campaignInfluencer: ciFilter } : {};
    const shipmentBf = deliverableBf;
    const directCampaignFilter = campaignId ? { campaignId } : {};

    const [
      overdue,
      removed,
      endingSoon,
      unassignedCount,
      shipmentIssues,
      expiringRights,
      ownerlessCount,
      ugcAwaiting,
      logisticsIssues,
      licenceIssues,
    ] = await Promise.all([
      prisma.deliverable.findMany({
        where: { AND: [overdueWhere(now), deliverableBf] },
        include: {
          campaignInfluencer: {
            select: {
              campaignId: true,
              influencer: { select: { displayName: true } },
              campaign: { select: { name: true, brandId: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: limit,
      }),
      prisma.publishedContent.findMany({
        where: {
          availabilityStatus: { in: [...REMOVED_STATUSES] },
          ...bf,
          ...directCampaignFilter,
        },
        include: { influencer: { select: { displayName: true } } },
        orderBy: { lastCheckedAt: 'desc' },
        take: limit,
      }),
      prisma.campaign.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { gte: now, lte: in5 },
          ...bf,
          ...(campaignId ? { id: campaignId } : {}),
        },
        orderBy: { endDate: 'asc' },
        take: limit,
      }),
      // Content Command Center pass — reuses the SAME "no campaign, no
      // influencer" derivation as everywhere else (never a stored column),
      // one roll-up entry rather than a row per item. Not meaningful when
      // scoped to a single campaign (unassigned content has no campaign by
      // definition), so skip the query entirely rather than return a
      // confusing always-zero count.
      campaignId
        ? Promise.resolve(0)
        : prisma.publishedContent.count({ where: { campaignId: null, influencerId: null, ...bf } }),
      prisma.productShipment.findMany({
        where: { status: { in: ['FAILED', 'RETURNED'] }, ...shipmentBf },
        include: {
          campaignInfluencer: {
            select: {
              campaignId: true,
              influencer: { select: { displayName: true } },
              campaign: { select: { name: true, brandId: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      prisma.usageRight.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { gte: now, lte: in14 },
          ...bf,
          ...directCampaignFilter,
        },
        include: { brand: { select: { name: true } } },
        orderBy: { expiresAt: 'asc' },
        take: limit,
      }),
      // "Campaigns missing an owner" is a discovery item, not something a
      // single already-open campaign's own board needs restated — skip
      // when scoped, same reasoning as unassignedCount above.
      campaignId
        ? Promise.resolve(0)
        : prisma.campaign.count({
            where: { ownerId: null, status: { in: ['ACTIVE', 'PLANNING'] }, ...bf },
          }),
      prisma.deliverableSubmission.findMany({
        where: { status: 'IN_REVIEW', deliverable: { campaignInfluencer: ciFilter } },
        include: {
          deliverable: {
            select: {
              campaignInfluencer: {
                select: {
                  campaignId: true,
                  influencer: { select: { displayName: true } },
                  campaign: { select: { name: true, brandId: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
      // Advanced Roles & Logistics Operations pass — the SAME LogisticsIssue
      // records the Logistics workspace and Influencer 360 show, surfaced
      // here as an actionable attention item, never a duplicate calculation.
      prisma.logisticsIssue.findMany({
        where: { status: 'OPEN', shipment: { campaignInfluencer: ciFilter } },
        include: {
          shipment: {
            select: {
              campaignInfluencer: {
                select: {
                  campaignId: true,
                  influencer: { select: { displayName: true } },
                  campaign: { select: { name: true, brandId: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
      // Creators who agreed to post without a licence covering the
      // campaign's countries (P3.5) — one line per campaign.
      makeLicenceService(ctx).campaignIssues(
        { ...bf, ...(campaignId ? { id: campaignId } : {}) },
        limit,
      ),
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
        params: {
          influencerName: d.campaignInfluencer.influencer.displayName,
          type: d.type,
          campaignName: d.campaignInfluencer.campaign.name,
        },
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
        params: {
          platform: c.platform,
          availabilityStatus: c.availabilityStatus,
          hasInfluencer: c.influencer ? 1 : 0,
          influencerName: c.influencer?.displayName ?? '',
        },
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
        params: { campaignName: c.name, endDate: c.endDate?.toISOString().slice(0, 10) ?? '' },
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
        params: {
          influencerName: s.campaignInfluencer.influencer.displayName,
          campaignName: s.campaignInfluencer.campaign.name,
        },
      });
    }
    for (const i of logisticsIssues) {
      const ci = i.shipment.campaignInfluencer;
      out.push({
        id: `logistics-issue-${i.id}`,
        kind: 'LOGISTICS_ADDRESS_ISSUE',
        title: `Address clarification needed — ${ci.influencer.displayName}`,
        // Deliberately generic, never the free-text description (which may
        // itself contain address/phone fragments) — same privacy posture as
        // the notification this issue already sent (never leak PII into a
        // surface with broader/less-controlled visibility than the record itself).
        description: `${LOGISTICS_ISSUE_TYPE_LABELS[i.type]} on a shipment for ${ci.campaign.name}.`,
        severity: 'danger',
        link: `/campaigns/${ci.campaignId}?tab=shipments`,
        at: i.createdAt.toISOString(),
        brandId: ci.campaign.brandId,
        campaignId: ci.campaignId,
        influencerId: null,
        actionLabel: 'Resolve in Logistics',
        params: {
          influencerName: ci.influencer.displayName,
          campaignName: ci.campaign.name,
          issueType: i.type,
        },
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
        params: {
          brandName: r.brand.name,
          usageType: r.usageType,
          expiresAt: r.expiresAt?.toISOString().slice(0, 10) ?? '',
        },
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
        params: { influencerName: ci.influencer.displayName, campaignName: ci.campaign.name },
      });
    }

    for (const l of licenceIssues) {
      const parts = [
        l.missing ? `${l.missing} without a valid licence` : null,
        l.expiring ? `${l.expiring} whose licence ends before the campaign does` : null,
      ].filter(Boolean);
      out.push({
        id: `licence-${l.campaign.id}`,
        kind: 'CREATOR_LICENCE',
        title: `Creator licences — ${l.campaign.name}`,
        description: `Creators on this campaign: ${parts.join(', ')}.`,
        // A creator posting without a licence is the legal risk; one that
        // only ends later is a heads-up.
        severity: l.missing && l.campaign.status === 'ACTIVE' ? 'danger' : 'warning',
        link: appRoutes.campaign(l.campaign.id, 'influencers'),
        at: now.toISOString(),
        brandId: l.campaign.brandId,
        campaignId: l.campaign.id,
        influencerId: null,
        actionLabel: 'Check licences',
        params: { campaignName: l.campaign.name, missing: l.missing, expiring: l.expiring },
      });
    }

    if (unassignedCount > 0) {
      out.push({
        id: 'unassigned-content',
        kind: 'UNASSIGNED_CONTENT',
        title: `${unassignedCount} unassigned content item${unassignedCount === 1 ? '' : 's'}`,
        description:
          'Published content with no campaign or influencer linked yet — resolve it from the content wall.',
        severity: 'warning',
        link: '/content?assignment=UNASSIGNED',
        at: now.toISOString(),
        brandId: brandId ?? null,
        campaignId: null,
        influencerId: null,
        actionLabel: 'Resolve content',
        params: { count: unassignedCount },
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
        params: { count: ownerlessCount },
      });
    }

    const severityRank = (s: string) => (s === 'danger' ? 0 : 1);
    return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, limit);
  }

  async function activeCampaignCards(
    brandId?: string,
    limit = 6,
  ): Promise<ActiveCampaignCardDTO[]> {
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
    // Brand scope (aggregate-leak-audit) — this was previously unscoped
    // entirely unless an explicit brandId was passed, leaking every brand's
    // upcoming publish schedule (creator name, campaign name, brand name) to
    // any authenticated brand-scoped actor who called /dashboard/global with
    // no brandId query param.
    const bf = await scopedBrandFilter(brandId);
    const rows = await prisma.campaignInfluencer.findMany({
      where: {
        expectedPublishAt: { gte: now, lte: in14 },
        ...(bf.brandId !== undefined ? { campaign: { brandId: bf.brandId } } : {}),
      },
      include: {
        influencer: {
          select: {
            displayName: true,
            primaryPlatform: true,
            avatarOverrideUrl: true,
            resolvedAvatarUrl: true,
          },
        },
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
    // Brand scope (aggregate-leak-audit) — this was previously unscoped
    // entirely unless an explicit brandId was passed, leaking every brand's
    // activity feed (campaign/content/shipment/cost events, each carrying a
    // free-text `message`) to any authenticated brand-scoped actor who
    // called /dashboard/global with no brandId query param. ActivityLog rows
    // not tied to any brand (brandId null — e.g. a purely user-level event)
    // stay visible, same posture as creator360.service.ts's timeline().
    const bf = await scopedBrandFilter(brandId);
    const where =
      bf.brandId !== undefined
        ? brandId
          ? { brandId: bf.brandId }
          : { OR: [{ brandId: null }, { brandId: bf.brandId }] }
        : {};
    const rows = await prisma.activityLog.findMany({
      where,
      include: { actor: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toActivityDTO);
  }

  async function global(brandId?: string): Promise<GlobalDashboardDTO> {
    const [
      pulseData,
      whatsNewData,
      whatsNewSummaryData,
      attentionData,
      activeData,
      upcomingData,
      activityData,
      contentSummaryData,
    ] = await Promise.all([
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
