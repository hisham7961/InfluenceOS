import type { DiscoveredPostDTO, DiscoveryRunDTO } from '@influenceos/contracts';
import type { requests, z } from '@influenceos/contracts';
import type { Platform, Prisma } from '@influenceos/database';
import { appRoutes, getAdapter, getAllCapabilities, type RecentPost } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { createNotification, iso } from '../lib/helpers';
import { matchPost, type MatchCampaign } from '../lib/post-matching';
import {
  isBrandOutOfScope,
  isCountryOutOfScope,
  scopedBrandIds,
  scopedCountryCodes,
} from '../lib/scope';
import { makeCampaignService } from './campaign.service';
import { makeContentService } from './content.service';

type AddInput = z.infer<typeof requests.discoveredPostAddSchema>;

/** Platforms whose adapters can list an account's newest posts. */
const LISTABLE: readonly Platform[] = ['INSTAGRAM', 'YOUTUBE', 'X'];
/** How often one account is looked at by the worker. */
export const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** "Look now" skips an account read this recently. */
const MANUAL_COOLDOWN_MS = 5 * 60 * 1000;
/** Creators still working on a campaign (not declined, dropped or done). */
const WORKING = ['INVITED', 'CONFIRMED', 'IN_PROGRESS'] as const;

const discoveredInclude = {
  influencer: {
    select: { id: true, displayName: true, avatarOverrideUrl: true, resolvedAvatarUrl: true },
  },
  deliverable: { select: { id: true, type: true, platform: true, dueDate: true } },
  decidedBy: { select: { name: true } },
} satisfies Prisma.DiscoveredPostInclude;
type Row = Prisma.DiscoveredPostGetPayload<{ include: typeof discoveredInclude }>;

function toDTO(r: Row): DiscoveredPostDTO {
  return {
    id: r.id,
    platform: r.platform,
    url: r.url,
    caption: r.caption,
    postedAt: iso(r.postedAt),
    mediaType: r.mediaType,
    influencer: {
      id: r.influencer.id,
      displayName: r.influencer.displayName,
      avatarUrl: r.influencer.avatarOverrideUrl ?? r.influencer.resolvedAvatarUrl ?? null,
    },
    campaignId: r.campaignId,
    campaignInfluencerId: r.campaignInfluencerId,
    deliverable: r.deliverable
      ? {
          id: r.deliverable.id,
          type: r.deliverable.type,
          platform: r.deliverable.platform,
          dueDate: iso(r.deliverable.dueDate),
        }
      : null,
    signals: r.signals,
    status: r.status,
    publishedContentId: r.publishedContentId,
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: iso(r.decidedAt),
    foundAt: r.foundAt.toISOString(),
  };
}

/**
 * Post discovery (P3.4): while a campaign runs, the creators' own accounts
 * are read (where the platform allows it with the configured key) and posts
 * whose caption carries the campaign's code, hashtags, mentions or brand name
 * are suggested for the campaign and a deliverable. Nothing is tracked until
 * someone adds it; a dismissed post is never suggested again.
 */
export function makeDiscoveryService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Platforms that can be read right now: listable, keyed, and not switched off. */
  async function readablePlatforms(): Promise<Platform[]> {
    const keyed = getAllCapabilities({ credentials: ctx.credentials })
      .filter((c) => c.apiConfigured && LISTABLE.includes(c.platform as Platform))
      .map((c) => c.platform as Platform);
    if (!keyed.length) return [];
    const off = await prisma.integrationSetting.findMany({
      where: { OR: [{ isEnabled: false }, { monitoringEnabled: false }] },
      select: { platform: true },
    });
    const offSet = new Set(off.map((o) => o.platform));
    return keyed.filter((p) => !offSet.has(p));
  }

  function workingOnLiveCampaign(): Prisma.SocialAccountWhereInput {
    return {
      influencer: {
        campaignInfluencers: {
          some: { participationStatus: { in: [...WORKING] }, campaign: { status: 'ACTIVE' } },
        },
      },
    };
  }

  /** The creator's running campaigns, shaped for matching. */
  async function liveCampaigns(influencerId: string): Promise<MatchCampaign[]> {
    const rows = await prisma.campaignInfluencer.findMany({
      where: {
        influencerId,
        participationStatus: { in: [...WORKING] },
        campaign: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        campaignId: true,
        createdAt: true,
        campaign: { select: { startDate: true, endDate: true, brand: { select: { name: true } } } },
        deliverables: {
          select: {
            id: true,
            platform: true,
            status: true,
            dueDate: true,
            requiredHashtags: true,
            requiredMentions: true,
          },
        },
      },
    });
    const codes = await prisma.promoCode.findMany({
      where: { influencerId, campaignId: { in: rows.map((r) => r.campaignId) }, isActive: true },
      select: { campaignId: true, code: true },
    });
    return rows.map((r) => ({
      campaignId: r.campaignId,
      campaignInfluencerId: r.id,
      brandName: r.campaign.brand.name,
      startDate: r.campaign.startDate,
      endDate: r.campaign.endDate,
      joinedAt: r.createdAt,
      codes: codes.filter((c) => c.campaignId === r.campaignId).map((c) => c.code),
      deliverables: r.deliverables,
    }));
  }

  /**
   * Suggest the posts that look like campaign work. Posts already tracked as
   * content, or already suggested (or dismissed), are skipped.
   */
  async function ingest(accountId: string, posts: RecentPost[], now = new Date()): Promise<number> {
    const account = await prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        platform: true,
        influencerId: true,
        influencer: { select: { displayName: true } },
      },
    });
    if (!account || !posts.length) return 0;
    const campaigns = await liveCampaigns(account.influencerId);
    if (!campaigns.length) return 0;

    const ids = posts.map((p) => p.externalId);
    const urls = posts.map((p) => p.url);
    const [tracked, seen] = await Promise.all([
      prisma.publishedContent.findMany({
        where: {
          platform: account.platform,
          OR: [{ externalId: { in: ids } }, { originalUrl: { in: urls } }],
        },
        select: { externalId: true, originalUrl: true },
      }),
      prisma.discoveredPost.findMany({
        where: { platform: account.platform, externalId: { in: ids } },
        select: { externalId: true },
      }),
    ]);
    const skip = new Set([
      ...tracked.map((t) => t.externalId).filter((x): x is string => !!x),
      ...seen.map((s) => s.externalId),
    ]);
    const trackedUrls = new Set(tracked.map((t) => t.originalUrl));

    const perCampaign = new Map<string, number>();
    for (const post of posts) {
      if (skip.has(post.externalId) || trackedUrls.has(post.url)) continue;
      const postedAt = post.postedAt ? new Date(post.postedAt) : null;
      const match = matchPost(
        { platform: account.platform, caption: post.caption, postedAt },
        campaigns,
        now,
      );
      if (!match) continue;
      const created = await prisma.discoveredPost
        .create({
          data: {
            platform: account.platform,
            externalId: post.externalId,
            url: post.url,
            caption: post.caption?.slice(0, 5000) ?? null,
            postedAt,
            mediaType: post.mediaType,
            influencerId: account.influencerId,
            socialAccountId: account.id,
            campaignId: match.campaignId,
            campaignInfluencerId: match.campaignInfluencerId,
            deliverableId: match.deliverableId,
            signals: match.signals,
          },
        })
        // Found by a parallel run a moment ago: nothing to add.
        .catch(() => null);
      if (created) perCampaign.set(match.campaignId, (perCampaign.get(match.campaignId) ?? 0) + 1);
    }

    for (const [campaignId, n] of perCampaign) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { name: true, brandId: true },
      });
      if (!campaign) continue;
      await createNotification(ctx, {
        category: 'GENERAL',
        title: 'New posts found for a campaign',
        body:
          n === 1
            ? `A new post from ${account.influencer.displayName} may belong to ${campaign.name}.`
            : `${n} new posts from ${account.influencer.displayName} may belong to ${campaign.name}.`,
        targetUrl: appRoutes.campaign(campaignId, 'content'),
        brandId: campaign.brandId,
        campaignId,
        influencerId: account.influencerId,
      });
    }
    return [...perCampaign.values()].reduce((a, b) => a + b, 0);
  }

  /** Read one account's newest posts and suggest the ones that match. */
  async function discoverAccount(
    accountId: string,
  ): Promise<{ found: number; error: string | null }> {
    const account = await prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { id: true, platform: true, username: true, platformUserId: true },
    });
    if (!account) return { found: 0, error: 'NOT_FOUND' };
    const adapter = getAdapter(account.platform, { credentials: ctx.credentials });
    const res = await adapter.listRecentPosts({
      username: account.username,
      platformUserId: account.platformUserId,
    });
    const now = new Date();
    if (!res.ok) {
      await prisma.socialAccount.update({
        where: { id: accountId },
        data: { lastDiscoveryAt: now, lastDiscoveryError: res.reason },
      });
      return { found: 0, error: res.reason };
    }
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { lastDiscoveryAt: now, lastDiscoveryError: null },
    });
    return { found: await ingest(accountId, res.data, now), error: null };
  }

  /**
   * The worker's share: claim accounts of creators on running campaigns that
   * weren't looked at in the last six hours (oldest first) and read them.
   */
  async function runDue(
    limit: number,
    now = new Date(),
  ): Promise<{ checked: number; found: number }> {
    const platforms = await readablePlatforms();
    if (!platforms.length || limit <= 0) return { checked: 0, found: 0 };
    const due = await prisma.socialAccount.findMany({
      where: {
        platform: { in: platforms },
        ...workingOnLiveCampaign(),
        OR: [
          { lastDiscoveryAt: null },
          { lastDiscoveryAt: { lt: new Date(now.getTime() - DISCOVERY_INTERVAL_MS) } },
        ],
      },
      orderBy: [{ lastDiscoveryAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    if (!due.length) return { checked: 0, found: 0 };
    // Claimed up front, so an overlapping sweep moves on to other accounts.
    await prisma.socialAccount.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { lastDiscoveryAt: now },
    });
    let found = 0;
    for (const { id } of due) {
      const r = await discoverAccount(id).catch(() => ({ found: 0, error: 'PROVIDER_ERROR' }));
      found += r.found;
    }
    return { checked: due.length, found };
  }

  // --- For people -----------------------------------------------------------

  async function listForCampaign(
    campaignId: string,
    status: 'NEW' | 'ADDED' | 'DISMISSED' = 'NEW',
  ): Promise<DiscoveredPostDTO[]> {
    await requireCapability(ctx, 'CONTENT_VIEW');
    await makeCampaignService(ctx).assertInScope(campaignId);
    const countries = await scopedCountryCodes(ctx);
    const rows = await prisma.discoveredPost.findMany({
      where: {
        campaignId,
        status,
        ...(countries ? { influencer: { countryCode: { in: countries } } } : {}),
      },
      include: discoveredInclude,
      orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }, { foundAt: 'desc' }],
      take: 100,
    });
    return rows.map(toDTO);
  }

  async function rowInScope(id: string) {
    const row = await prisma.discoveredPost.findUnique({
      where: { id },
      include: {
        campaign: { select: { brandId: true } },
        influencer: { select: { countryCode: true } },
      },
    });
    if (
      !row ||
      isBrandOutOfScope(await scopedBrandIds(ctx), row.campaign.brandId) ||
      isCountryOutOfScope(await scopedCountryCodes(ctx), row.influencer.countryCode)
    ) {
      throw AppError.notFound('Suggested post');
    }
    return row;
  }

  async function reload(id: string): Promise<DiscoveredPostDTO> {
    return toDTO(
      await prisma.discoveredPost.findUniqueOrThrow({ where: { id }, include: discoveredInclude }),
    );
  }

  /** Add a found post to its campaign as tracked content. */
  async function add(id: string, input: AddInput): Promise<DiscoveredPostDTO> {
    const actor = await requireCapability(ctx, 'CONTENT_MANAGE');
    const row = await rowInScope(id);
    if (row.status !== 'NEW') throw AppError.conflict('This post was already added or dismissed.');
    const deliverableId =
      input.deliverableId === undefined ? row.deliverableId : input.deliverableId;
    if (deliverableId) {
      const d = await prisma.deliverable.findUnique({
        where: { id: deliverableId },
        select: { campaignInfluencerId: true },
      });
      if (!d || d.campaignInfluencerId !== row.campaignInfluencerId) {
        throw AppError.badRequest("That deliverable isn't this creator's on this campaign.");
      }
    }
    let contentId: string;
    try {
      const created = await makeContentService(ctx).create({
        url: row.url,
        campaignId: row.campaignId,
        influencerId: row.influencerId,
        campaignInfluencerId: row.campaignInfluencerId,
        deliverableId: deliverableId ?? null,
        caption: row.caption,
        publishedAt: row.postedAt,
      });
      contentId = created.id;
    } catch (e) {
      // Someone added the same post by hand in the meantime: link to it.
      if (!(e instanceof AppError && e.code === 'CONFLICT')) throw e;
      const existing = await prisma.publishedContent.findFirst({
        where: {
          platform: row.platform,
          OR: [{ externalId: row.externalId }, { originalUrl: row.url }],
        },
        select: { id: true },
      });
      if (!existing) throw e;
      contentId = existing.id;
    }
    await prisma.discoveredPost.update({
      where: { id },
      data: {
        status: 'ADDED',
        publishedContentId: contentId,
        deliverableId: deliverableId ?? null,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
    return reload(id);
  }

  /** Not campaign work: never suggested again. */
  async function dismiss(id: string): Promise<DiscoveredPostDTO> {
    const actor = await requireCapability(ctx, 'CONTENT_MANAGE');
    const row = await rowInScope(id);
    if (row.status !== 'NEW') throw AppError.conflict('This post was already added or dismissed.');
    await prisma.discoveredPost.update({
      where: { id },
      data: { status: 'DISMISSED', decidedById: actor.id, decidedAt: new Date() },
    });
    return reload(id);
  }

  /** "Look for new posts now" for a campaign's creators. */
  async function discoverForCampaign(campaignId: string): Promise<DiscoveryRunDTO> {
    await requireCapability(ctx, 'CONTENT_MANAGE');
    await makeCampaignService(ctx).assertInScope(campaignId);
    const countries = await scopedCountryCodes(ctx);
    const platforms = await readablePlatforms();
    const accounts = await prisma.socialAccount.findMany({
      where: {
        influencer: {
          ...(countries ? { countryCode: { in: countries } } : {}),
          campaignInfluencers: { some: { campaignId, participationStatus: { in: [...WORKING] } } },
        },
      },
      select: { id: true, platform: true, username: true, lastDiscoveryAt: true },
      take: 60,
    });
    const out: DiscoveryRunDTO = { checked: 0, found: 0, recent: 0, unavailable: [] };
    const now = Date.now();
    for (const a of accounts) {
      if (!platforms.includes(a.platform)) {
        out.unavailable.push({
          platform: a.platform,
          username: a.username,
          reason: LISTABLE.includes(a.platform) ? 'NO_CREDENTIAL' : 'NOT_SUPPORTED_BY_PLATFORM',
        });
        continue;
      }
      if (a.lastDiscoveryAt && now - a.lastDiscoveryAt.getTime() < MANUAL_COOLDOWN_MS) {
        out.recent++;
        continue;
      }
      const r = await discoverAccount(a.id);
      if (r.error)
        out.unavailable.push({ platform: a.platform, username: a.username, reason: r.error });
      else {
        out.checked++;
        out.found += r.found;
      }
    }
    return out;
  }

  return {
    ingest,
    discoverAccount,
    runDue,
    listForCampaign,
    add,
    dismiss,
    discoverForCampaign,
    readablePlatforms,
  };
}

export type DiscoveryService = ReturnType<typeof makeDiscoveryService>;
