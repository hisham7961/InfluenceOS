import { randomUUID } from 'node:crypto';
import {
  buildEmbed,
  contentReviewStatus,
  getAdapter,
  metrics as sharedMetrics,
  normalizeContentUrl,
  resolveContentThumbnail,
  type Platform,
} from '@influenceos/shared';
import {
  requests,
  type BrandContentSummaryDTO,
  type ContentMetricsDTO,
  type ContentSummaryDTO,
  type ContentViewerStateDTO,
  type CursorPage,
  type MonitoringEventDTO,
  type PublishedContentDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma, type ContentStatus } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireCapability } from '../lib/authz';
import { resolveContentAssociation } from '../lib/content-association';
import { createNotification, iso, logActivity } from '../lib/helpers';
import { isBrandOutOfScope, isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';
import { resolveAttachmentDownloadUrl } from '../lib/storage';
import {
  toBrandSummary,
  toContentMetricsDTO,
  toInfluencerSummary,
  toPublishedContentDTO,
} from '../lib/mappers';

type ContentCreate = z.infer<typeof requests.publishedContentCreateSchema>;
type StoryCreate = z.infer<typeof requests.publishedContentStoryCreateSchema>;
type ContentUpdate = z.infer<typeof requests.publishedContentUpdateSchema>;
type ContentFilter = z.infer<typeof requests.contentFilterSchema>;
type ManualMetrics = z.infer<typeof requests.contentMetricSchema>;
type ContentViewStateInput = z.infer<typeof requests.contentViewStateSchema>;
type ContentSummaryQuery = z.infer<typeof requests.contentSummaryQuerySchema>;

const REMOVED_STATUSES: ContentStatus[] = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'];

// No authenticated user ever has this id — used so the viewerStates
// relation filter always safely returns "no row" for system/unauthenticated
// contexts, instead of branching the include's TS shape per call site.
const NO_ACTOR = '__no_actor__';

/**
 * Per-user viewer state is joined in the SAME query as everything else (one
 * row per content, filtered to the calling user) — never a separate fetch
 * per card (Content Command Center pass, item 55).
 */
function relIncludeFor(userId: string | undefined) {
  return {
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
    viewerStates: { where: { userId: userId ?? NO_ACTOR }, take: 1 },
    // Internal team comment count for the ContentCard "has comments" badge —
    // top-level only, excludes soft-deleted notes, distinct from the
    // platform's own public engagement comment count (metrics.comments).
    _count: { select: { notes: { where: { parentId: null, deletedAt: null } } } },
    // A Story's media — the screenshot/recording uploaded right after
    // createStory() returns the row id. Regular (link) content never has
    // one; take 1 in case a re-upload ever adds a second attachment.
    attachments: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { id: true, storageKey: true, fileName: true, mimeType: true, kind: true },
    },
  } satisfies Prisma.PublishedContentInclude;
}

function youtubeThumb(platform: Platform, externalId: string | null): string | null {
  if (platform === 'YOUTUBE' && externalId) {
    return `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`;
  }
  return null;
}

export function makeContentService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function mapRow(pc: Prisma.PublishedContentGetPayload<{ include: ReturnType<typeof relIncludeFor> }>): Promise<PublishedContentDTO> {
    const latest = pc.metricSnapshots[0] ?? null;
    const vs = pc.viewerStates[0] ?? null;
    const viewerState: ContentViewerStateDTO | null = vs
      ? { firstSeenAt: iso(vs.firstSeenAt), lastOpenedAt: iso(vs.lastOpenedAt), reviewedAt: iso(vs.reviewedAt), savedForLaterAt: iso(vs.savedForLaterAt) }
      : null;
    const attachment = pc.attachments[0] ?? null;
    const storyMedia =
      pc.isStory && attachment
        ? {
            url: await resolveAttachmentDownloadUrl(attachment.id, attachment.storageKey, attachment.fileName),
            kind: attachment.kind === 'video' ? ('video' as const) : ('image' as const),
            mimeType: attachment.mimeType,
          }
        : null;
    return toPublishedContentDTO(pc, {
      influencer: pc.influencer ? toInfluencerSummary(pc.influencer) : null,
      brand: pc.brand ? toBrandSummary(pc.brand) : null,
      campaign: pc.campaign ? { id: pc.campaign.id, name: pc.campaign.name, slug: pc.campaign.slug } : null,
      deliverable: pc.deliverable ? { id: pc.deliverable.id, type: pc.deliverable.type, platform: pc.deliverable.platform } : null,
      metrics: toContentMetricsDTO(latest),
      viewerState,
      commentCount: pc._count.notes,
      storyMedia,
    });
  }

  /**
   * Direct-ID Brand + Creator Country scope guard (Security & Authorization
   * Freeze Gate, section 37 item 2) — every accessor that resolves a SINGLE
   * content row by id (detail, update, refresh, manual metrics, metrics
   * history, monitoring events) must independently confirm the actor's own
   * scope, not merely rely on out-of-scope rows being filtered out of
   * feed()'s list. Mirrors campaign.service.ts's assertInScope() and
   * influencer.service.ts's detail()/update(): reads as not-found, never
   * forbidden, so a scoped actor can never even confirm an out-of-scope
   * content id exists. `brandId == null` content (never linked to a brand)
   * is not brand-restricted — matches create()/update()'s existing posture
   * via resolveContentAssociation, which never restricts fully-unassigned
   * content — and `influencerId == null` content carries no creator-country
   * dimension to restrict.
   */
  async function assertContentInScope(pc: { brandId: string | null; influencerId: string | null }): Promise<void> {
    const brandScope = await scopedBrandIds(ctx);
    if (pc.brandId && isBrandOutOfScope(brandScope, pc.brandId)) throw AppError.notFound('Content');
    if (!pc.influencerId) return;
    const countryScope = await scopedCountryCodes(ctx);
    if (!countryScope) return;
    const influencer = await prisma.influencer.findUnique({
      where: { id: pc.influencerId },
      select: { countryCode: true },
    });
    if (isCountryOutOfScope(countryScope, influencer?.countryCode ?? null)) throw AppError.notFound('Content');
  }

  async function loadDTO(id: string): Promise<PublishedContentDTO> {
    const pc = await prisma.publishedContent.findUnique({ where: { id }, include: relIncludeFor(ctx.actor?.id) });
    if (!pc) throw AppError.notFound('Content');
    await assertContentInScope({ brandId: pc.brandId, influencerId: pc.influencerId });
    return await mapRow(pc);
  }

  async function create(input: ContentCreate): Promise<PublishedContentDTO> {
    await requireCapability(ctx, 'CONTENT_MANAGE');
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
        include: relIncludeFor(ctx.actor?.id),
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

    return await mapRow(pc);
  }

  /**
   * A Story screenshot/recording — no live post to link (Stories expire, so
   * there's no fetchable URL), a required `platform` in place of one, and no
   * embed/thumbnail/dedup logic (all of that keys off a real originalUrl,
   * which a Story doesn't have). `originalUrl` still stores a synthetic,
   * globally-unique `story://<uuid>` placeholder so the existing
   * `@@unique([platform, originalUrl])` constraint and every caller that
   * treats `originalUrl` as a non-null string keep working unchanged. The
   * actual media is a follow-up attachment upload (POST /files/initiate with
   * target.publishedContentId = this row's id), surfaced back on the DTO as
   * `storyMedia` once mapRow() picks it up.
   */
  async function createStory(input: StoryCreate): Promise<PublishedContentDTO> {
    await requireCapability(ctx, 'CONTENT_MANAGE');

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

    const originalUrl = `story://${randomUUID()}`;

    const pc = await prisma.$transaction(async (tx) => {
      const created = await tx.publishedContent.create({
        data: {
          platform: input.platform,
          externalId: null,
          originalUrl,
          embedUrl: null,
          thumbnailUrl: null,
          caption: input.caption ?? null,
          publishedAt: input.publishedAt ?? null,
          brandId,
          campaignId,
          influencerId,
          campaignInfluencerId,
          deliverableId,
          availabilityStatus: 'LIVE',
          dataSource: 'MANUAL',
          nextCheckAt: null,
          isStory: true,
        },
        include: relIncludeFor(ctx.actor?.id),
      });

      // Link the deliverable — advances campaign progress automatically (§55, DoD),
      // same as create()'s own link step above.
      if (deliverableId) {
        const deliverable = await tx.deliverable.findUnique({ where: { id: deliverableId } });
        if (deliverable && deliverable.status !== 'VERIFIED') {
          await tx.deliverable.update({
            where: { id: deliverableId },
            data: {
              status: 'PUBLISHED',
              publishedUrl: originalUrl,
              publishedAt: input.publishedAt ?? new Date(),
            },
          });
        }
      }

      await logActivity(
        ctx,
        {
          type: 'CONTENT_PUBLISHED',
          message: `${ctx.actor?.name ?? 'Someone'} added a ${input.platform} Story.`,
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
          title: 'New Story added',
          body: `A new ${input.platform} Story was added to the live content wall.`,
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

    return await mapRow(pc);
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

    // Current-user review state (Content Command Center pass) — filtered via
    // the SAME UserContentState relation the card/viewer read, so "New 18" in
    // a filter chip and clicking it always agree.
    const actorId = ctx.actor?.id;
    if (filter.reviewState && actorId) {
      if (filter.reviewState === 'NEW') {
        where.viewerStates = { none: { userId: actorId } };
      } else if (filter.reviewState === 'SEEN') {
        where.viewerStates = { some: { userId: actorId, firstSeenAt: { not: null }, reviewedAt: null } };
      } else if (filter.reviewState === 'REVIEWED') {
        where.viewerStates = { some: { userId: actorId, reviewedAt: { not: null } } };
      } else if (filter.reviewState === 'REVIEW_LATER') {
        where.viewerStates = { some: { userId: actorId, savedForLaterAt: { not: null } } };
      }
    }

    // The "Alerts" filter chip — any availability status needing attention.
    if (filter.alertsOnly) {
      where.availabilityStatus = { in: REMOVED_STATUSES };
    }

    // Security & Authorization Freeze Gate, section 37 item 2 — Brand +
    // Creator Country scope, composed server-side into the feed query itself
    // (never a client-side post-filter of a downloaded page), same posture
    // as every other brand-touching service (campaign.service.ts's
    // buildWhere(), influencer.service.ts's buildWhere()). Content with no
    // brand (brandId == null) stays visible to a scoped actor — matches
    // create()/update()'s own posture via resolveContentAssociation, which
    // never restricts fully-unassigned content — and content with no
    // influencer carries no creator-country dimension to restrict. An
    // explicit out-of-scope filter.brandId/influencerId above still matches
    // nothing once ANDed with these conditions, same as every other scoped
    // list.
    const scopeConditions: Prisma.PublishedContentWhereInput[] = [];
    const brandScope = await scopedBrandIds(ctx);
    if (brandScope) {
      scopeConditions.push({ OR: [{ brandId: { in: brandScope } }, { brandId: null }] });
    }
    const countryScope = await scopedCountryCodes(ctx);
    if (countryScope) {
      scopeConditions.push({ OR: [{ influencerId: null }, { influencer: { countryCode: { in: countryScope } } }] });
    }
    if (scopeConditions.length) where.AND = scopeConditions;

    const rows = await prisma.publishedContent.findMany({
      where,
      include: relIncludeFor(actorId),
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const data = await Promise.all(rows.slice(0, filter.limit).map((r) => mapRow(r)));
    return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null, hasMore };
  }

  async function detail(id: string): Promise<PublishedContentDTO> {
    return loadDTO(id);
  }

  async function update(id: string, input: ContentUpdate): Promise<PublishedContentDTO> {
    await requireCapability(ctx, 'CONTENT_MANAGE');
    const existing = await prisma.publishedContent.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Content');

    // A scoped operator can't touch content outside their brand access — or,
    // when it's tied to an influencer, their creator-country access — at all
    // (Security & Authorization Freeze Gate, section 37 item 2;
    // WORKFLOW_GAP_MATRIX.md, "Permissions/privacy"). Reads as not-found
    // rather than forbidden, same posture as brand.service.ts — never
    // confirms the row exists.
    await assertContentInScope({ brandId: existing.brandId, influencerId: existing.influencerId });
    const scope = await scopedBrandIds(ctx);

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
    // Direct-ID scope guard (Security & Authorization Freeze Gate, section 37
    // item 2) — a scoped actor can't read another brand/creator-country's
    // metric history by id, same as detail()/update().
    const existing = await prisma.publishedContent.findUnique({
      where: { id },
      select: { brandId: true, influencerId: true },
    });
    if (!existing) throw AppError.notFound('Content');
    await assertContentInScope(existing);
    const snaps = await prisma.contentMetricSnapshot.findMany({
      where: { publishedContentId: id },
      orderBy: { capturedAt: 'asc' },
      take: 200,
    });
    return snaps.map((s) => toContentMetricsDTO(s)!);
  }

  async function monitoring(id: string): Promise<MonitoringEventDTO[]> {
    // Direct-ID scope guard (Security & Authorization Freeze Gate, section 37
    // item 2) — same as metricsHistory() above.
    const existing = await prisma.publishedContent.findUnique({
      where: { id },
      select: { brandId: true, influencerId: true },
    });
    if (!existing) throw AppError.notFound('Content');
    await assertContentInScope(existing);
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
    await requireCapability(ctx, 'CONTENT_MANAGE');
    const existing = await prisma.publishedContent.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Content');
    // Direct-ID scope guard (Security & Authorization Freeze Gate, section 37
    // item 2) — checked BEFORE recordMetrics() writes anything, so an
    // out-of-scope call never leaves a side effect behind even though it's
    // ultimately rejected.
    await assertContentInScope({ brandId: existing.brandId, influencerId: existing.influencerId });
    await recordMetrics(id, input, 'MANUAL');
    return loadDTO(id);
  }

  /**
   * Availability + metric sync via the platform adapter. Shared by the worker
   * (system context, unscoped) and an on-demand refresh button. Records
   * monitoring events, status changes and alerts. Never throws on provider
   * failure.
   */
  async function refresh(id: string): Promise<PublishedContentDTO> {
    const pc = await prisma.publishedContent.findUnique({ where: { id } });
    if (!pc) throw AppError.notFound('Content');
    // Direct-ID scope guard (Security & Authorization Freeze Gate, section 37
    // item 2) — checked BEFORE any monitoring event/notification/adapter call
    // runs, so an out-of-scope refresh never leaves a side effect behind.
    await assertContentInScope({ brandId: pc.brandId, influencerId: pc.influencerId });
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

    // Metrics (best-effort, official only). Instagram keys its lookup off the
    // owning handle rather than the post id (an IG post URL carries no
    // username), so pass the influencer's account for this platform when we
    // have one; adapters that don't need it ignore it.
    try {
      const ownerUsername = pc.influencerId
        ? (
            await prisma.socialAccount.findFirst({
              where: { influencerId: pc.influencerId, platform: pc.platform },
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              select: { username: true },
            })
          )?.username ?? null
        : null;
      const res = await adapter.syncContentMetrics({
        externalId: pc.externalId,
        originalUrl: pc.originalUrl,
        ownerUsername,
      });
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

  /**
   * Per-user New/Seen/Reviewed/Review-Later state (Content Command Center
   * pass). `seen` is what the Viewer/detail page sends on open — idempotent:
   * firstSeenAt is stamped once and never overwritten, lastOpenedAt advances
   * every time. Never writes to the shared ActivityLog — a personal triage
   * action (seen/reviewed/review-later) is not an operational event the rest
   * of the team needs in a campaign/brand timeline, unlike association or
   * shipment changes.
   */
  async function updateViewState(id: string, input: ContentViewStateInput): Promise<ContentViewerStateDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.publishedContent.findUnique({ where: { id }, select: { id: true, brandId: true } });
    if (!existing) throw AppError.notFound('Content');
    const scope = await scopedBrandIds(ctx);
    if (existing.brandId && isBrandOutOfScope(scope, existing.brandId)) throw AppError.notFound('Content');

    const now = new Date();
    // Reviewing implies having seen it — a caller can't mark something
    // Reviewed without it also becoming Seen (matches the real UI, where
    // the Viewer always marks Seen on open before the Reviewed button is
    // even reachable; enforced here too so the derivation in
    // contentReviewStatus() never has to reconcile the two).
    const impliesSeen = input.seen || input.reviewed === true;
    const row = await prisma.$transaction(async (tx) => {
      const prev = await tx.userContentState.findUnique({
        where: { userId_publishedContentId: { userId: actor.id, publishedContentId: id } },
      });
      const create = {
        userId: actor.id,
        publishedContentId: id,
        firstSeenAt: impliesSeen ? now : null,
        lastOpenedAt: input.seen ? now : null,
        reviewedAt: input.reviewed ? now : null,
        savedForLaterAt: input.reviewLater ? now : null,
      };
      // The update SET clause includes ONLY the field(s) this call was asked
      // to change — never all four recomputed from `prev`. The Viewer fires
      // a fire-and-forget "seen" stamp on open, which can still be in flight
      // when a "Mark Reviewed" click's own call reads/writes the same row;
      // if both calls blindly rewrote every field from their own (possibly
      // stale) `prev` snapshot, whichever commits last would silently wipe
      // out the other's write — a real lost-update race, not hypothetical
      // (it's what let a freshly-reviewed item still show up as "New").
      const update: Prisma.UserContentStateUpdateInput = {};
      if (impliesSeen && !prev?.firstSeenAt) update.firstSeenAt = now;
      if (input.seen) update.lastOpenedAt = now;
      if (input.reviewed !== undefined) update.reviewedAt = input.reviewed ? now : null;
      if (input.reviewLater !== undefined) update.savedForLaterAt = input.reviewLater ? now : null;
      return tx.userContentState.upsert({
        where: { userId_publishedContentId: { userId: actor.id, publishedContentId: id } },
        create,
        update,
      });
    });

    return { firstSeenAt: iso(row.firstSeenAt), lastOpenedAt: iso(row.lastOpenedAt), reviewedAt: iso(row.reviewedAt), savedForLaterAt: iso(row.savedForLaterAt) };
  }

  /**
   * One efficient call for every Content Command Center count: the top filter
   * chips, the daily summary panel, and the By Brand overview (items 53-54) —
   * never one request per statistic, never an N+1 across brands (groupBy).
   */
  async function summary(query: ContentSummaryQuery): Promise<ContentSummaryDTO> {
    const actor = requireActor(ctx);
    const scope = await scopedBrandIds(ctx);
    const scopeWhere: Prisma.PublishedContentWhereInput = scope ? { brandId: { in: scope } } : {};

    const now = new Date();
    const todayStart = query.todayStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayEnd = query.todayEnd ?? new Date(todayStart.getTime() + 86_400_000);
    // publishedAt when trustworthy/available, detectedAt fallback — same
    // date-source rule the Timeline uses (never mislabel detection time as
    // publication time).
    const todayWhere: Prisma.PublishedContentWhereInput = {
      OR: [
        { publishedAt: { gte: todayStart, lt: todayEnd } },
        { publishedAt: null, detectedAt: { gte: todayStart, lt: todayEnd } },
      ],
    };

    const [new_, seen, reviewed, reviewLater, unassigned, alerts, todayRows, brands, newByBrand, alertsByBrand, latestByBrand] =
      await Promise.all([
        prisma.publishedContent.count({ where: { ...scopeWhere, viewerStates: { none: { userId: actor.id } } } }),
        prisma.publishedContent.count({
          where: { ...scopeWhere, viewerStates: { some: { userId: actor.id, firstSeenAt: { not: null }, reviewedAt: null } } },
        }),
        prisma.publishedContent.count({ where: { ...scopeWhere, viewerStates: { some: { userId: actor.id, reviewedAt: { not: null } } } } }),
        prisma.publishedContent.count({
          where: { ...scopeWhere, viewerStates: { some: { userId: actor.id, savedForLaterAt: { not: null } } } },
        }),
        prisma.publishedContent.count({ where: { ...scopeWhere, campaignId: null, influencerId: null } }),
        prisma.publishedContent.count({ where: { ...scopeWhere, availabilityStatus: { in: REMOVED_STATUSES } } }),
        prisma.publishedContent.findMany({
          where: { ...scopeWhere, ...todayWhere },
          select: {
            brandId: true,
            availabilityStatus: true,
            viewerStates: { where: { userId: actor.id }, take: 1, select: { firstSeenAt: true, reviewedAt: true } },
          },
        }),
        prisma.brand.findMany({
          where: scope ? { id: { in: scope } } : {},
          select: { id: true, name: true, logoUrl: true, primaryColor: true },
          orderBy: { name: 'asc' },
        }),
        prisma.publishedContent.groupBy({
          by: ['brandId'],
          where: { ...scopeWhere, brandId: { not: null }, viewerStates: { none: { userId: actor.id } } },
          _count: true,
        }),
        prisma.publishedContent.groupBy({
          by: ['brandId'],
          where: { ...scopeWhere, brandId: { not: null }, availabilityStatus: { in: REMOVED_STATUSES } },
          _count: true,
        }),
        prisma.publishedContent.groupBy({
          by: ['brandId'],
          where: { ...scopeWhere, brandId: { not: null } },
          _max: { detectedAt: true },
        }),
      ]);

    let todayNew = 0;
    let todaySeen = 0;
    let todayReviewed = 0;
    let todayAlerts = 0;
    const brandsActiveTodaySet = new Set<string>();
    for (const row of todayRows) {
      const vs = row.viewerStates[0] ?? null;
      const status = contentReviewStatus(vs ? { firstSeenAt: iso(vs.firstSeenAt), lastOpenedAt: null, reviewedAt: iso(vs.reviewedAt), savedForLaterAt: null } : null);
      if (status === 'NEW') todayNew++;
      else if (status === 'SEEN') todaySeen++;
      else todayReviewed++;
      if (REMOVED_STATUSES.includes(row.availabilityStatus)) todayAlerts++;
      if (row.brandId) brandsActiveTodaySet.add(row.brandId);
    }

    const newByBrandMap = new Map(newByBrand.map((r) => [r.brandId, r._count]));
    const alertsByBrandMap = new Map(alertsByBrand.map((r) => [r.brandId, r._count]));
    const latestByBrandMap = new Map(latestByBrand.map((r) => [r.brandId, r._max.detectedAt]));
    const todayByBrandMap = new Map<string, number>();
    for (const row of todayRows) {
      if (!row.brandId) continue;
      todayByBrandMap.set(row.brandId, (todayByBrandMap.get(row.brandId) ?? 0) + 1);
    }

    const brandSummaries: BrandContentSummaryDTO[] = brands.map((b) => ({
      brandId: b.id,
      brandName: b.name,
      logoUrl: b.logoUrl,
      primaryColor: b.primaryColor,
      today: todayByBrandMap.get(b.id) ?? 0,
      new: newByBrandMap.get(b.id) ?? 0,
      alerts: alertsByBrandMap.get(b.id) ?? 0,
      latestContentAt: iso(latestByBrandMap.get(b.id) ?? null),
    }));

    return {
      new: new_,
      seen,
      reviewed,
      reviewLater,
      unassigned,
      alerts,
      today: { total: todayRows.length, new: todayNew, seen: todaySeen, reviewed: todayReviewed, alerts: todayAlerts, brandsActive: brandsActiveTodaySet.size },
      brands: brandSummaries,
    };
  }

  return {
    create,
    createStory,
    feed,
    detail,
    update,
    metricsHistory,
    monitoring,
    addManualMetrics,
    refresh,
    mapRow,
    relIncludeFor,
    updateViewState,
    summary,
  };
}

export type ContentService = ReturnType<typeof makeContentService>;
