import {
  buildEmbed,
  getAdapter,
  metrics as sharedMetrics,
  normalizeContentUrl,
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
import { createNotification, iso, logActivity } from '../lib/helpers';
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

    // Resolve associations. A deliverable implies its campaign influencer + campaign.
    let campaignId = input.campaignId ?? null;
    let brandId = input.brandId ?? null;
    let influencerId = input.influencerId ?? null;
    let campaignInfluencerId = input.campaignInfluencerId ?? null;

    if (input.deliverableId) {
      const deliverable = await prisma.deliverable.findUnique({
        where: { id: input.deliverableId },
        include: { campaignInfluencer: { select: { id: true, campaignId: true, influencerId: true } } },
      });
      if (deliverable) {
        campaignInfluencerId = campaignInfluencerId ?? deliverable.campaignInfluencer.id;
        campaignId = campaignId ?? deliverable.campaignInfluencer.campaignId;
        influencerId = influencerId ?? deliverable.campaignInfluencer.influencerId;
      }
    }
    if (campaignId && !brandId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { brandId: true } });
      brandId = campaign?.brandId ?? null;
    }

    const embed = buildEmbed(canonicalUrl, platform);

    const pc = await prisma.publishedContent.create({
      data: {
        platform,
        externalId,
        originalUrl: canonicalUrl,
        embedUrl: embed?.iframeSrc ?? null,
        embedConfig: embed ? (embed as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        thumbnailUrl: youtubeThumb(platform, externalId),
        caption: input.caption ?? null,
        publishedAt: input.publishedAt ?? null,
        brandId,
        campaignId,
        influencerId,
        campaignInfluencerId,
        deliverableId: input.deliverableId ?? null,
        availabilityStatus: 'UNKNOWN',
        dataSource: 'MANUAL',
        nextCheckAt: new Date(),
      },
      include: relInclude,
    });

    // Link the deliverable — advances campaign progress automatically (§55, DoD).
    if (input.deliverableId) {
      const deliverable = await prisma.deliverable.findUnique({ where: { id: input.deliverableId } });
      if (deliverable && deliverable.status !== 'VERIFIED') {
        await prisma.deliverable.update({
          where: { id: input.deliverableId },
          data: {
            status: 'PUBLISHED',
            publishedUrl: canonicalUrl,
            publishedAt: input.publishedAt ?? new Date(),
          },
        });
      }
    }

    await logActivity(ctx, {
      type: 'CONTENT_PUBLISHED',
      message: `${ctx.actor?.name ?? 'Someone'} added a published ${platform} post.`,
      brandId,
      campaignId,
      influencerId,
      publishedContentId: pc.id,
    });
    await createNotification(ctx, {
      category: 'NEW_CONTENT',
      title: 'New content published',
      body: `A new ${platform} post was added to the live content wall.`,
      targetUrl: `/content/${pc.id}`,
      brandId,
      campaignId,
      influencerId,
      publishedContentId: pc.id,
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
    await prisma.publishedContent.update({
      where: { id },
      data: {
        caption: input.caption === undefined ? undefined : input.caption,
        campaignId: input.campaignId === undefined ? undefined : input.campaignId,
        influencerId: input.influencerId === undefined ? undefined : input.influencerId,
        deliverableId: input.deliverableId === undefined ? undefined : input.deliverableId,
        availabilityStatus: input.availabilityStatus ?? undefined,
        publishedAt: input.publishedAt === undefined ? undefined : input.publishedAt,
      },
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

    void failure;
    return loadDTO(id);
  }

  return { create, feed, detail, update, metricsHistory, monitoring, addManualMetrics, refresh, mapRow, relInclude };
}

export type ContentService = ReturnType<typeof makeContentService>;
