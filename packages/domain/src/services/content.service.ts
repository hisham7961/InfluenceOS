import {
  buildEmbed,
  getAdapter,
  metrics as sharedMetrics,
  normalizeContentUrl,
  resolveContentThumbnail,
  type Platform,
} from '@influenceos/shared';
import {
  requests,
  type ContentMetricsDTO,
  type CursorPage,
  type MonitoringEventDTO,
  type PublishedContentDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma, type ContentStatus } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { resolveContentAssociation } from '../lib/content-association';
import { createNotification, iso, logActivity } from '../lib/helpers';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';
import {
  toBrandSummary,
  toContentMetricsDTO,
  toInfluencerSummary,
  toPublishedContentDTO,
} from '../lib/mappers';

type ContentCreate = z.infer<typeof requests.publishedContentCreateSchema>;
type ContentUpdate = z.infer<typeof requests.publishedContentUpdateSchema>;
type ContentFilter = z.infer<typeof requests.contentFilterSchema>;
type ManualMetrics = z.infer<typeof requests.contentMetricSchema>;

const REMOVED_STATUSES: ContentStatus[] = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'];

const relInclude = {
  influencer: {
    include: {
      socialAccounts: { select: { platform: true, followers: true, isPrimary: true, avatarUrl: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  },
  brand: {
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      iconUrl: true,
      primaryColor: true,
      accentColor: true,
      isActive: true,
    },
  },
  campaign: { select: { id: true, name: true, slug: true } },
  deliverable: { select: { id: true, type: true, platform: true } },
  metricSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
} satisfies Prisma.PublishedContentInclude;

function youtubeThumb(platform: Platform, externalId: string | null): string | null {
  if (platform === 'YOUTUBE' && externalId) {
    return `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`;
  }
  return null;
}

export function makeContentService(ctx: DomainContext) {
  const { prisma } = ctx;

  function mapRow(pc: Prisma.PublishedContentGetPayload<{ include: typeof relInclude }>): PublishedContentDTO {
    const latest = pc.metricSnapshots[0] ?? null;
    return toPublishedContentDTO(pc, {
      influencer: pc.influencer ? toInfluencerSummary(pc.influencer) : null,
      brand: pc.brand ? toBrandSummary(pc.brand) : null,
      campaign: pc.campaign ? { id: pc.campaign.id, name: pc.campaign.name, slug: pc.campaign.slug } : null,
      deliverable: pc.deliverable ? { id: pc.deliverable.id, type: pc.deliverable.type, platform: pc.deliverable.platform } : null,
      metrics: toContentMetricsDTO(latest),
    });
  }

  async function loadDTO(id: string): Promise<PublishedContentDTO> {
    const pc = await prisma.publishedContent.findUnique({ where: { id }, include: relInclude });
    if (!pc) throw AppError.notFound('Content');
    return mapRow(pc);
  }

  async function create(input: ContentCreate): Promise<PublishedContentDTO> {
    requireActor(ctx);
    const normalized = normalizeContentUrl(input.url);
    if (!normalized) {
      throw AppError.badRequest('That URL is not from a supported platform (Instagram, TikTok, YouTube, Snapchat, X).');
    }
    const { platform, canonicalUrl, externalId } = normalized;

    const existing = await prisma.publishedContent.findUnique({
      where: { platform_originalUrl: { platform, originalUrl: canonicalUrl } },
    });
    if (existing) throw AppError.conflict('This content URL is already being tracked.');

    // Resolve + validate associations centrally — never duplicate this logic in
    // another service or in Web; see packages/domain/src/lib/content-association.ts.
    // A deliverable/campaignInfluencer implies its own campaign/influencer/brand,
    // and a caller-supplied value that disagrees with that chain is rejected
    // rather than silently overwritten or silently discarded.
    const scope = await scopedBrandIds(ctx);
    const { campaignId, brandId, influencerId, campaignInfluencerId, deliverableId } =
      await resolveContentAssociation(
        prisma,
        {
          brandId: input.brandId,
          campaignId: input.campaignId,
          influencerId: input.influencerId,
          campaignInfluencerId: input.campaignInfluencerId,
          deliverableId: input.deliverableId,
        },
        scope,
      );

    const embed = buildEmbed(canonicalUrl, platform);

    // Fetch the real cover image (public oEmbed / og:image — no credentials) so
    // the card shows the video's cover instead of a blank placeholder. Best
    // effort and time-boxed; if it can't be found now, the monitor refresh
    // retries. YouTube is derived instantly with no network call.
    const thumbnailUrl =
      (await resolveContentThumbnail({ platform, canonicalUrl, externalId, timeoutMs: 3500 }).catch(() => null)) ??
      youtubeThumb(platform, externalId);

    // Atomic (DB-07): the content row, the deliverable status advance, the
    // activity record and the notification either all land or none do, so a
    // partial failure can't leave content with no activity/notification or a
    // deliverable stuck out of sync.
    const pc = await prisma.$transaction(async (tx) => {
      const created = await tx.publishedContent.create({
        data: {
          platform,
          externalId,
          originalUrl: canonicalUrl,
          embedUrl: embed?.iframeSrc ?? null,
          embedConfig: embed ? (embed as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          thumbnailUrl,
          caption: input.caption ?? null,
          publishedAt: input.publishedAt ?? null,
          brandId,
          campaignId,
          influencerId,
          campaignInfluencerId,
          deliverableId,
          availabilityStatus: 'UNKNOWN',
          dataSource: 'MANUAL',
          nextCheckAt: new Date(),
        },
        include: relInclude,
      });

      // Link the deliverable — advances campaign progress automatically (§55, DoD).
      if (deliverableId) {
        const deliverable = await tx.deliverable.findUnique({ where: { id: deliverableId } });
        if (deliverable && deliverable.status !== 'VERIFIED') {
          await tx.deliverable.update({
            where: { id: deliverableId },
            data: {
              status: 'PUBLISHED',
              publishedUrl: canonicalUrl,
              publishedAt: input.publishedAt ?? new Date(),
            },
          });
        }
      }

      await logActivity(
        ctx,
        {
          type: 'CONTENT_PUBLISHED',
          message: `${ctx.actor?.name ?? 'Someone'} added a published ${platform} post.`,
          brandId,
          campaignId,
          influencerId,
          publishedContentId: created.id,
        },
        tx,
      );
      await createNotification(
        ctx,
        {
          category: 'NEW_CONTENT',
          title: 'New content published',
          body: `A new ${platform} post was added to the live content wall.`,
          targetUrl: `/content/${created.id}`,
          brandId,
          campaignId,
          influencerId,
          publishedContentId: created.id,
        },
        tx,
      );

      return created;
    });

    return mapRow(pc);
  }

  async function feed(filter: ContentFilter): Promise<CursorPage<PublishedContentDTO>> {
    const where: Prisma.PublishedContentWhereInput = {};
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.campaignId) where.campaignId = filter.campaignId;
    if (filter.influencerId) where.influencerId = filter.influencerId;
    if (filter.platform) where.platform = filter.platform;
    if (filter.status) where.availabilityStatus = filter.status;
    if (filter.from || filter.to) {
      where.detectedAt = {};
      if (filter.from) where.detectedAt.gte = filter.from;
      if (filter.to) where.detectedAt.lte = filter.to;
    }
    if (filter.q) {
      where.OR = [
        { caption: { contains: filter.q, mode: 'insensitive' } },
        { originalUrl: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    // Derived assignment status — computed from presence, matched server-side so
    // pagination stays correct across pages (see contentAssociationStatus).
    if (filter.assignment === 'UNASSIGNED') {
      where.campaignId = null;
      where.influencerId = null;
    } else if (filter.assignment === 'INFLUENCER_LINKED') {
      where.campaignId = null;
      where.influencerId = { not: null };
    } else if (filter.assignment === 'CAMPAIGN_LINKED') {
      where.campaignId = { not: null };
      where.influencerId = null;
    } else if (filter.assignment === 'FULLY_LINKED') {
      where.campaignId = { not: null };
      where.influencerId = { not: null };
    }

    const rows = await prisma.publishedContent.findMany({
      where,
      include: relInclude,
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const data = rows.slice(0, filter.limit).map((r) => mapRow(r));
    return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null, hasMore };
  }

  async function detail(id: string): Promise<PublishedContentDTO> {
    return loadDTO(id);
  }

  async function update(id: string, input: ContentUpdate): Promise<PublishedContentDTO> {
    requireActor(ctx);
    const existing = await prisma.publishedContent.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Content');

    // A scoped operator can't touch content outside their brand access at
    // all — not just re-link it elsewhere (WORKFLOW_GAP_MATRIX.md,
    // "Permissions/privacy"). Reads as not-found rather than forbidden, same
    // posture as brand.service.ts — never confirms the row exists.
    const scope = await scopedBrandIds(ctx);
    if (existing.brandId && isBrandOutOfScope(scope, existing.brandId)) {
      throw AppError.notFound('Content');
    }

    // Re-linking (assign/change/remove influencer, campaign or deliverable) goes
    // through the same centralized resolver as create() — this is what makes
    // reassignment safe: brandId and campaignInfluencerId are always recomputed
    // from the effective campaign/influencer/deliverable, never left stale.
    const touchesAssociation =
      input.campaignId !== undefined || input.influencerId !== undefined || input.deliverableId !== undefined;
    // If the caller changes campaignId/influencerId to something other than
    // what they were, WITHOUT also naming a new deliverableId, the existing
    // deliverable link can no longer be valid (a deliverable's campaign/
    // influencer are fixed) — drop it rather than let it silently re-derive
    // the very campaign/influencer the caller just asked to change (the bug
    // this comment replaced: clearing campaignId while a stale deliverableId
    // carried forward would snap campaignId right back via the deliverable
    // anchor, silently ignoring the caller's explicit change).
    const associationChanged =
      (input.campaignId !== undefined && input.campaignId !== existing.campaignId) ||
      (input.influencerId !== undefined && input.influencerId !== existing.influencerId);
    const effectiveDeliverableId =
      input.deliverableId !== undefined ? input.deliverableId : associationChanged ? null : existing.deliverableId;
    const resolved = touchesAssociation
      ? await resolveContentAssociation(
          prisma,
          {
            campaignId: input.campaignId === undefined ? existing.campaignId : input.campaignId,
            influencerId: input.influencerId === undefined ? existing.influencerId : input.influencerId,
            deliverableId: effectiveDeliverableId,
          },
          scope,
        )
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.publishedContent.update({
        where: { id },
        data: {
          caption: input.caption === undefined ? undefined : input.caption,
          campaignId: resolved ? resolved.campaignId : undefined,
          influencerId: resolved ? resolved.influencerId : undefined,
          deliverableId: resolved ? resolved.deliverableId : undefined,
          campaignInfluencerId: resolved ? resolved.campaignInfluencerId : undefined,
          brandId: resolved ? resolved.brandId : undefined,
          availabilityStatus: input.availabilityStatus ?? undefined,
          publishedAt: input.publishedAt === undefined ? undefined : input.publishedAt,
        },
      });

      if (
        resolved &&
        (resolved.campaignId !== existing.campaignId ||
          resolved.influencerId !== existing.influencerId ||
          resolved.deliverableId !== existing.deliverableId)
      ) {
        await logActivity(
          ctx,
          {
            type: 'GENERIC',
            message: `${ctx.actor?.name ?? 'Someone'} updated this content's associations.`,
            brandId: resolved.brandId,
            campaignId: resolved.campaignId,
            influencerId: resolved.influencerId,
            publishedContentId: id,
          },
          tx,
        );
      }
    });

    return loadDTO(id);
  }

  async function metricsHistory(id: string): Promise<ContentMetricsDTO[]> {
    const snaps = await prisma.contentMetricSnapshot.findMany({
      where: { publishedContentId: id },
      orderBy: { capturedAt: 'asc' },
      take: 200,
    });
    return snaps.map((s) => toContentMetricsDTO(s)!);
  }

  async function monitoring(id: string): Promise<MonitoringEventDTO[]> {
    const events = await prisma.contentMonitoringEvent.findMany({
      where: { publishedContentId: id },
      orderBy: { checkedAt: 'desc' },
      take: 50,
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      message: e.message,
      success: e.success,
      checkedAt: e.checkedAt.toISOString(),
    }));
  }

  function computeEngagementRate(m: {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    views: number | null;
  }): number | null {
    return sharedMetrics.engagementRate(
      { likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves },
      { views: m.views },
    );
  }

  async function recordMetrics(
    id: string,
    m: {
      views?: number | null;
      likes?: number | null;
      comments?: number | null;
      shares?: number | null;
      reposts?: number | null;
      saves?: number | null;
    },
    source: 'MANUAL' | 'OFFICIAL_API',
  ) {
    const values = {
      views: m.views ?? null,
      likes: m.likes ?? null,
      comments: m.comments ?? null,
      shares: m.shares ?? null,
      reposts: m.reposts ?? null,
      saves: m.saves ?? null,
    };
    const engagementRate = computeEngagementRate(values);
    await prisma.$transaction([
      prisma.contentMetricSnapshot.create({
        data: { publishedContentId: id, ...values, engagementRate, source },
      }),
      prisma.publishedContent.update({
        where: { id },
        data: { lastMetricsSyncAt: new Date() },
      }),
    ]);
  }

  /** Manual metric entry for platforms with no official metrics API. */
  async function addManualMetrics(id: string, input: ManualMetrics): Promise<PublishedContentDTO> {
    requireActor(ctx);
    const existing = await prisma.publishedContent.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Content');
    await recordMetrics(id, input, 'MANUAL');
    return loadDTO(id);
  }

  /**
   * Availability + metric sync via the platform adapter. Shared by the worker
   * and an on-demand refresh button. Records monitoring events, status changes
   * and alerts. Never throws on provider failure.
   */
  async function refresh(id: string): Promise<PublishedContentDTO> {
    const pc = await prisma.publishedContent.findUnique({ where: { id } });
    if (!pc) throw AppError.notFound('Content');
    const adapter = getAdapter(pc.platform, { credentials: ctx.credentials });

    // Availability
    let newStatus: ContentStatus = pc.availabilityStatus;
    let failure = false;
    try {
      const avail = await adapter.checkContentAvailability({
        externalId: pc.externalId,
        originalUrl: pc.originalUrl,
      });
      newStatus = avail.status as ContentStatus;
      const changed = newStatus !== pc.availabilityStatus;
      await prisma.contentMonitoringEvent.create({
        data: {
          publishedContentId: id,
          type: changed ? 'STATUS_CHANGED' : 'CHECK_OK',
          fromStatus: pc.availabilityStatus,
          toStatus: newStatus,
          message: avail.message ?? null,
          httpStatus: avail.httpStatus ?? null,
          success: true,
        },
      });
      await prisma.publishedContent.update({
        where: { id },
        data: {
          availabilityStatus: newStatus,
          lastCheckedAt: new Date(),
          nextCheckAt: new Date(Date.now() + 6 * 3600 * 1000),
          checkFailureCount: 0,
        },
      });
      if (changed && REMOVED_STATUSES.includes(newStatus)) {
        await logActivity(ctx, {
          type: 'CONTENT_STATUS_CHANGED',
          message: `A ${pc.platform} post changed status from ${pc.availabilityStatus} to ${newStatus}.`,
          brandId: pc.brandId,
          campaignId: pc.campaignId,
          influencerId: pc.influencerId,
          publishedContentId: id,
          meta: { from: pc.availabilityStatus, to: newStatus },
        });
        await createNotification(ctx, {
          category: newStatus === 'REMOVED' ? 'CONTENT_REMOVED' : 'CONTENT_UNAVAILABLE',
          title: `Content ${newStatus.toLowerCase()}`,
          body: `A tracked ${pc.platform} post is now ${newStatus.toLowerCase()}.`,
          targetUrl: `/content/${id}`,
          brandId: pc.brandId,
          campaignId: pc.campaignId,
          publishedContentId: id,
        });
      }
    } catch {
      failure = true;
      await prisma.contentMonitoringEvent.create({
        data: { publishedContentId: id, type: 'CHECK_FAILED', success: false, message: 'Availability check failed' },
      });
      await prisma.publishedContent.update({
        where: { id },
        data: { checkFailureCount: { increment: 1 }, lastCheckedAt: new Date() },
      });
    }

    // Metrics (best-effort, official only)
    try {
      const res = await adapter.syncContentMetrics({ externalId: pc.externalId, originalUrl: pc.originalUrl });
      if (res.ok) await recordMetrics(id, res.data, 'OFFICIAL_API');
    } catch {
      /* metrics are optional; ignore */
    }

    // Backfill the public cover image if we still don't have one (e.g. a
    // TikTok/IG post added before this ran, or whose oEmbed was slow on add).
    if (!pc.thumbnailUrl) {
      try {
        const thumb = await resolveContentThumbnail({
          platform: pc.platform,
          canonicalUrl: pc.originalUrl,
          externalId: pc.externalId,
          timeoutMs: 4000,
        });
        if (thumb) await prisma.publishedContent.update({ where: { id }, data: { thumbnailUrl: thumb } });
      } catch {
        /* cover is optional; ignore */
      }
    }

    void failure;
    return loadDTO(id);
  }

  return { create, feed, detail, update, metricsHistory, monitoring, addManualMetrics, refresh, mapRow, relInclude };
}

export type ContentService = ReturnType<typeof makeContentService>;
