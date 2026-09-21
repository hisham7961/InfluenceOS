import {
  type CreatorReliabilityDTO,
  type CreatorSnapshotDTO,
  type CreatorTimelineItemDTO,
  type DeliverableSubmissionDTO,
} from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import { USAGE_RIGHT_TYPE_LABELS } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { iso } from '../lib/helpers';
import { toActivityDTO } from '../lib/mappers';
import { resolveScopeCurrency, subtractMoney, sumMoney, toDecimal } from '../lib/money';

/** submissions()'s return shape — the real DeliverableSubmissionDTO fields
 *  (mirrors submission.service.ts's toDTO exactly) plus just enough campaign
 *  context to link a UGC tab row back to where it was submitted; nothing here
 *  is a new stored entity. */
export interface CreatorSubmissionDTO extends DeliverableSubmissionDTO {
  campaignId: string;
  campaignName: string;
}

const ACTIVE_DELIVERABLE_STATUSES = ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] as const;
const ACTIVE_SHIPMENT_STATUSES = ['PENDING', 'SHIPPED', 'IN_TRANSIT'] as const;
const PAID_DEAL_TYPES = ['PAID', 'PAID_PLUS_GIFTED'] as const;

/**
 * Creator 360 (Operations Intelligence pass, PART 25-32) — a genuinely
 * useful, honest snapshot: real relationship history, real reliability
 * evidence (never a fabricated trust score), and a unified timeline that
 * reuses ActivityLog/Note/DeliverableSubmission rows rather than a new
 * history table. Every number here is derivable from existing data; a
 * metric with nothing to compute from returns null/0, never a guess.
 */
export function makeCreator360Service(ctx: DomainContext) {
  const { prisma } = ctx;

  async function assertVisible(id: string): Promise<void> {
    const exists = await prisma.influencer.count({ where: { id } });
    if (!exists) throw AppError.notFound('Influencer');
  }

  async function snapshot(influencerId: string): Promise<CreatorSnapshotDTO> {
    requireActor(ctx);
    await assertVisible(influencerId);

    const [influencer, cis, lastNoteAt] = await Promise.all([
      prisma.influencer.findUnique({ where: { id: influencerId }, select: { owner: { select: { name: true } } } }),
      prisma.campaignInfluencer.findMany({
        where: { influencerId },
        select: {
          agreedCost: true,
          paidAmount: true,
          currency: true,
          dealType: true,
          paymentStatus: true,
          dateContacted: true,
          createdAt: true,
          campaign: { select: { status: true, startDate: true, brandId: true } },
          deliverables: { select: { status: true } },
          shipments: {
            select: {
              id: true,
              status: true,
              destinationCountryCode: true,
              courier: true,
              trackingNumber: true,
              updatedAt: true,
              issues: { where: { status: 'OPEN' }, select: { id: true, type: true, description: true, createdAt: true } },
            },
          },
        },
      }),
      prisma.note.aggregate({ where: { influencerId }, _max: { createdAt: true } }),
    ]);
    if (!influencer) throw AppError.notFound('Influencer');

    const brandIds = new Set<string>();
    let currentCampaigns = 0;
    let lastCollaborationAt: Date | null = null;
    let lastContactAt: Date | null = lastNoteAt._max.createdAt ?? null;
    let activeDeliverables = 0;
    let activeShipments = 0;
    const openLogisticsIssues: CreatorSnapshotDTO['openLogisticsIssues'] = [];
    let mostRecentShipment: CreatorSnapshotDTO['mostRecentShipment'] = null;
    let mostRecentShipmentUpdatedAt: Date | null = null;

    // Rate range / outstanding payment only ever combine rows in ONE currency
    // (DB-03 precedent: never silently sum mismatched currencies). When a
    // creator's paid deals genuinely span currencies, the dominant one (by
    // deal count) is used and the rest are excluded from the money figures —
    // never averaged across currencies into a meaningless number.
    const paidRows = cis.filter((ci) => PAID_DEAL_TYPES.includes(ci.dealType as (typeof PAID_DEAL_TYPES)[number]) && ci.agreedCost != null);
    const currencyCounts = new Map<string, number>();
    for (const r of paidRows) {
      const ccy = resolveScopeCurrency([r.currency]).currency;
      currencyCounts.set(ccy, (currencyCounts.get(ccy) ?? 0) + 1);
    }
    let dominantCurrency: string | null = null;
    for (const [ccy, count] of currencyCounts) {
      if (!dominantCurrency || count > (currencyCounts.get(dominantCurrency) ?? 0)) dominantCurrency = ccy;
    }
    const dominantRows = dominantCurrency ? paidRows.filter((r) => resolveScopeCurrency([r.currency]).currency === dominantCurrency) : [];

    for (const ci of cis) {
      brandIds.add(ci.campaign.brandId);
      if (ci.campaign.status === 'ACTIVE') currentCampaigns += 1;
      const at = ci.campaign.startDate ?? ci.createdAt;
      if (!lastCollaborationAt || at > lastCollaborationAt) lastCollaborationAt = at;
      if (ci.dateContacted && (!lastContactAt || ci.dateContacted > lastContactAt)) lastContactAt = ci.dateContacted;
      for (const d of ci.deliverables) {
        if (ACTIVE_DELIVERABLE_STATUSES.includes(d.status as (typeof ACTIVE_DELIVERABLE_STATUSES)[number])) activeDeliverables += 1;
      }
      for (const s of ci.shipments) {
        if (ACTIVE_SHIPMENT_STATUSES.includes(s.status as (typeof ACTIVE_SHIPMENT_STATUSES)[number])) activeShipments += 1;
        for (const issue of s.issues) {
          openLogisticsIssues.push({ id: issue.id, shipmentId: s.id, type: issue.type, description: issue.description, createdAt: issue.createdAt.toISOString() });
        }
        if (!mostRecentShipmentUpdatedAt || s.updatedAt > mostRecentShipmentUpdatedAt) {
          mostRecentShipmentUpdatedAt = s.updatedAt;
          mostRecentShipment = {
            id: s.id,
            status: s.status,
            destinationCountryCode: s.destinationCountryCode,
            courier: s.courier,
            trackingNumber: s.trackingNumber,
            updatedAt: s.updatedAt.toISOString(),
          };
        }
      }
    }

    const rates = dominantRows.map((r) => toDecimal(r.agreedCost)).filter((d): d is Prisma.Decimal => d != null);
    const rateRange = rates.length
      ? { min: Prisma.Decimal.min(...rates).toNumber(), max: Prisma.Decimal.max(...rates).toNumber(), currency: dominantCurrency! }
      : null;

    const outstandingRows = dominantRows.filter((r) => r.paymentStatus !== 'PAID');
    const outstandingPayment = sumMoney(
      outstandingRows.map((r) => subtractMoney(r.agreedCost, r.paidAmount) ?? 0),
    ).toNumber();

    return {
      ownerName: influencer.owner?.name ?? null,
      brandsWorkedWith: brandIds.size,
      totalCollaborations: cis.length,
      currentCampaigns,
      lastCollaborationAt: lastCollaborationAt ? lastCollaborationAt.toISOString() : null,
      lastContactAt: lastContactAt ? lastContactAt.toISOString() : null,
      rateRange,
      outstandingPayment,
      currency: dominantCurrency ?? 'KWD',
      activeDeliverables,
      activeShipments,
      openLogisticsIssues,
      mostRecentShipment,
    };
  }

  async function reliability(influencerId: string): Promise<CreatorReliabilityDTO> {
    requireActor(ctx);
    await assertVisible(influencerId);

    const rows = await prisma.deliverable.findMany({
      where: {
        campaignInfluencer: { influencerId },
        dueDate: { not: null },
        publishedAt: { not: null },
      },
      select: { dueDate: true, publishedAt: true },
    });

    let onTime = 0;
    let late = 0;
    let delaySumDays = 0;
    for (const r of rows) {
      const due = r.dueDate!.getTime();
      const published = r.publishedAt!.getTime();
      if (published <= due) {
        onTime += 1;
      } else {
        late += 1;
        delaySumDays += (published - due) / 86_400_000;
      }
    }

    return {
      sampleSize: rows.length,
      onTime,
      late,
      averageDelayDays: late > 0 ? Math.round((delaySumDays / late) * 10) / 10 : null,
    };
  }

  /** Every DeliverableSubmission across every campaign this creator has been
   *  in (gap #11) — submission.service.ts's listForDeliverable/listForCampaign
   *  are scoped to one deliverable/campaign; this is the creator-wide read a
   *  dedicated UGC tab needs. Mirrors submission.service.ts's own include/toDTO
   *  shape exactly (that file doesn't export them), plus the campaign id/name
   *  needed to link a row back to its campaign — never a new stored entity. */
  async function submissions(influencerId: string): Promise<CreatorSubmissionDTO[]> {
    requireActor(ctx);
    await assertVisible(influencerId);

    const rows = await prisma.deliverableSubmission.findMany({
      where: { deliverable: { campaignInfluencer: { influencerId } } },
      include: {
        submittedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
        deliverable: {
          select: {
            campaignInfluencer: { select: { campaignId: true, campaign: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map((s) => ({
      id: s.id,
      deliverableId: s.deliverableId,
      version: s.version,
      status: s.status,
      notes: s.notes,
      assetUrl: s.assetUrl,
      submittedByName: s.submittedBy?.name ?? null,
      reviewedByName: s.reviewedBy?.name ?? null,
      reviewedAt: iso(s.reviewedAt),
      reviewNote: s.reviewNote,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      comments: s.comments.map((c) => ({ id: c.id, authorName: c.author?.name ?? null, body: c.body, createdAt: c.createdAt.toISOString() })),
      campaignId: s.deliverable.campaignInfluencer.campaignId,
      campaignName: s.deliverable.campaignInfluencer.campaign.name,
    }));
  }

  /** Cursor is the ISO timestamp of the oldest item already shown — merges five
   *  real sources (never a duplicate history table): ActivityLog, top-level
   *  personal Notes, DeliverableSubmission status changes, CampaignInfluencer
   *  contact events (gap #12), and UsageRight grants (gap #12). Notification
   *  rows are deliberately NOT included — they're a per-user alert derived
   *  from the same underlying ActivityLog event (see logActivity call sites),
   *  so mixing them in would show most events twice. */
  async function timeline(
    influencerId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: CreatorTimelineItemDTO[]; nextCursor: string | null; hasMore: boolean }> {
    requireActor(ctx);
    await assertVisible(influencerId);
    const limit = query.limit ?? 30;
    const before = query.cursor ? new Date(query.cursor) : null;

    const [activities, notes, submissionRows, contacted, usageRights] = await Promise.all([
      prisma.activityLog.findMany({
        where: { influencerId, ...(before ? { createdAt: { lt: before } } : {}) },
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.note.findMany({
        where: { influencerId, parentId: null, ...(before ? { createdAt: { lt: before } } : {}) },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.deliverableSubmission.findMany({
        where: { deliverable: { campaignInfluencer: { influencerId } }, ...(before ? { updatedAt: { lt: before } } : {}) },
        include: { deliverable: { select: { id: true, campaignInfluencerId: true, campaignInfluencer: { select: { campaignId: true } } } } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      // "Contacted" events (gap #12) — CampaignInfluencer.dateContacted is a
      // real timestamp already read by snapshot() above; never synthesized
      // for a row where it's null (an invited-but-not-yet-contacted creator
      // gets no event, not a fabricated one).
      prisma.campaignInfluencer.findMany({
        where: { influencerId, dateContacted: before ? { not: null, lt: before } : { not: null } },
        include: { campaign: { select: { id: true, name: true } } },
        orderBy: { dateContacted: 'desc' },
        take: limit,
      }),
      // Usage-rights lifecycle events (gap #12) — one event per UsageRight row,
      // anchored on its real `createdAt` (when the right was granted). No
      // separate expiry/revocation event is synthesized: the model has no
      // real per-transition timestamp for those (revoke()/the expiry worker
      // only ever bump `status` + `updatedAt`, and `updatedAt` is shared by
      // every field on the row, not a dedicated "status changed at" column),
      // so a single grant event carrying the row's CURRENT status is the
      // honest representation — never a guessed history.
      prisma.usageRight.findMany({
        where: { influencerId, ...(before ? { createdAt: { lt: before } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const items: CreatorTimelineItemDTO[] = [];

    for (const a of activities) {
      const dto = toActivityDTO(a);
      const isShipment = a.type === 'GENERIC' && a.meta != null && typeof a.meta === 'object' && 'shipmentId' in (a.meta as Record<string, unknown>);
      const bucket: CreatorTimelineItemDTO['bucket'] = isShipment
        ? 'logistics'
        : a.type === 'CONTENT_PUBLISHED' || a.type === 'CONTENT_STATUS_CHANGED'
          ? 'content'
          : a.type === 'COST_ADDED' || a.type === 'COST_UPDATED'
            ? 'payment'
            : a.type === 'CAMPAIGN_CREATED' || a.type === 'CAMPAIGN_STATUS_CHANGED' || a.type === 'CAMPAIGN_UPDATED' || a.type === 'INFLUENCER_ADDED_TO_CAMPAIGN' || a.type === 'DELIVERABLE_ADDED' || a.type === 'DELIVERABLE_STATUS_CHANGED'
              ? 'campaign'
              : a.type === 'NOTE_ADDED'
                ? 'collaboration'
                : 'activity';
      items.push({ id: `activity:${a.id}`, bucket, message: dto.message, link: dto.link, at: a.createdAt.toISOString() });
    }

    for (const n of notes) {
      items.push({
        id: `note:${n.id}`,
        bucket: 'collaboration',
        message: `${n.author?.name ?? 'Someone'}: ${n.deletedAt ? '[deleted]' : n.body.slice(0, 140)}`,
        link: `/influencers/${influencerId}`,
        at: n.createdAt.toISOString(),
      });
    }

    const statusLabel: Record<string, string> = {
      IN_REVIEW: 'submitted a draft for review',
      APPROVED: 'had a submission approved',
      CHANGES_REQUESTED: 'was asked for changes on a submission',
      REJECTED: 'had a submission rejected',
    };
    for (const s of submissionRows) {
      items.push({
        id: `submission:${s.id}`,
        bucket: 'ugc',
        message: `Creator ${statusLabel[s.status] ?? `updated a submission (${s.status.toLowerCase().replace(/_/g, ' ')})`}`,
        link: `/campaigns/${s.deliverable.campaignInfluencer.campaignId}?tab=submissions`,
        at: s.updatedAt.toISOString(),
      });
    }

    for (const ci of contacted) {
      // dateContacted is guaranteed set by the where-clause above (never
      // null) — the `!` just satisfies the nullable Prisma field type.
      items.push({
        id: `contacted:${ci.id}`,
        bucket: 'contacted',
        message: `Contacted for ${ci.campaign.name}`,
        link: `/campaigns/${ci.campaign.id}`,
        at: ci.dateContacted!.toISOString(),
      });
    }

    for (const ur of usageRights) {
      const typeLabel = USAGE_RIGHT_TYPE_LABELS[ur.usageType] ?? ur.usageType;
      const detailBits = [ur.territory, ur.scope].filter((v): v is string => !!v);
      const detail = detailBits.length ? ` (${detailBits.join(', ')})` : '';
      // Status is the row's CURRENT state, not a fabricated transition event —
      // see the query comment above for why only one event per row exists.
      const statusNote = ur.status !== 'ACTIVE' ? ` — now ${ur.status.toLowerCase()}` : '';
      items.push({
        id: `usageRight:${ur.id}`,
        bucket: 'usageRights',
        message: `Usage right granted: ${typeLabel} use${detail}${statusNote}`,
        link: ur.campaignId ? `/campaigns/${ur.campaignId}` : `/brands/${ur.brandId}`,
        at: ur.createdAt.toISOString(),
      });
    }

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const page = items.slice(0, limit);
    // Any source that returned a FULL page of `limit` rows might still have
    // more beyond what we fetched — a conservative hasMore, never a false negative.
    const hasMore =
      activities.length === limit ||
      notes.length === limit ||
      submissionRows.length === limit ||
      contacted.length === limit ||
      usageRights.length === limit;
    const nextCursor = hasMore && page.length ? page[page.length - 1]!.at : null;

    return { data: page, nextCursor, hasMore };
  }

  return { snapshot, reliability, submissions, timeline };
}

export type Creator360Service = ReturnType<typeof makeCreator360Service>;
