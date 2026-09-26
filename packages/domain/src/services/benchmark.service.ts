import type {
  BenchmarkCellDTO,
  BenchmarkDTO,
  BenchmarkStatsDTO,
  FollowerTier,
  Platform,
  requests,
  z,
} from '@influenceos/contracts';
import type { Prisma } from '@influenceos/database';
import { FOLLOWER_TIERS, PLATFORMS, followerTier, metrics } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAnyCapability } from '../lib/authz';
import { BENCHMARK_MIN_SAMPLE, mainAccount, summarize } from '../lib/benchmarks';
import { hasCapability } from '../lib/capabilities';
import { memo } from '../lib/memo';
import { toMoneyNumber } from '../lib/money';
import { isBrandOutOfScope, isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';
import { PAID_DEALS } from '../lib/spend';
import { makeCampaignService } from './campaign.service';

type BenchmarkQuery = z.infer<typeof requests.benchmarkQuerySchema>;

/** Bookings that went ahead: the creator said yes (declined, dropped and not-yet-answered don't count). */
const AGREED = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

interface Booking {
  id: string;
  platform: Platform | null;
  tier: FollowerTier | null;
  currency: string;
  feePerPost: number;
  costPerView: number | null;
  engagementRate: number | null;
}

function stats(rows: Booking[], moneyVisible: boolean): BenchmarkStatsDTO {
  return {
    bookings: rows.length,
    feePerPost: moneyVisible ? summarize(rows.map((r) => r.feePerPost)) : null,
    costPerView: moneyVisible ? summarize(rows.map((r) => r.costPerView)) : null,
    engagementRate: summarize(rows.map((r) => r.engagementRate)),
  };
}

function monthsAgo(months: number, now = new Date()): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/**
 * Rate benchmarks (P3.7): what similar creators were paid, from the agency's
 * own confirmed paid bookings — by the platform and follower tier the creator
 * had when booked. Fee per post is the agreed fee over the posts planned;
 * cost per view and engagement rate come from the latest numbers on their
 * posts for that campaign. Same brand and country scope as everything else;
 * fee and cost figures need finance access.
 */
export function makeBenchmarkService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Platform and tier to narrow to, from a roster row or a creator when asked. */
  async function resolveTarget(query: BenchmarkQuery): Promise<{
    platform: Platform | null;
    tier: FollowerTier | null;
    excludeId: string | null;
  }> {
    let platform: Platform | null = null;
    let tier: FollowerTier | null = null;
    let excludeId: string | null = null;
    let influencerId = query.influencerId ?? null;

    if (query.campaignInfluencerId) {
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: query.campaignInfluencerId },
        select: {
          id: true,
          campaignId: true,
          influencerId: true,
          platformAtBooking: true,
          followersAtBooking: true,
          influencer: { select: { countryCode: true } },
        },
      });
      if (!ci) throw AppError.notFound('Campaign influencer');
      await makeCampaignService(ctx).assertInScope(ci.campaignId);
      // The campaign being in scope never opens up a creator outside the reader's countries.
      if (isCountryOutOfScope(await scopedCountryCodes(ctx), ci.influencer.countryCode)) {
        throw AppError.notFound('Campaign influencer');
      }
      excludeId = ci.id;
      platform = ci.platformAtBooking;
      tier = followerTier(ci.followersAtBooking);
      influencerId = platform && tier ? null : ci.influencerId;
    }

    if (influencerId) {
      const inf = await prisma.influencer.findUnique({
        where: { id: influencerId },
        select: {
          countryCode: true,
          primaryPlatform: true,
          socialAccounts: { select: { platform: true, followers: true, isPrimary: true } },
        },
      });
      if (!inf || isCountryOutOfScope(await scopedCountryCodes(ctx), inf.countryCode)) {
        throw AppError.notFound('Influencer');
      }
      const brandScope = await scopedBrandIds(ctx);
      if (brandScope && !query.campaignInfluencerId) {
        const link = await prisma.brandInfluencer.findFirst({
          where: { influencerId, brandId: { in: brandScope } },
          select: { id: true },
        });
        if (!link) throw AppError.notFound('Influencer');
      }
      const main = mainAccount(inf.socialAccounts, inf.primaryPlatform);
      platform = platform ?? main?.platform ?? null;
      tier = tier ?? followerTier(main?.followers);
    }

    return {
      platform: query.platform ?? platform,
      tier: query.tier ?? tier,
      excludeId,
    };
  }

  async function loadBookings(query: BenchmarkQuery, excludeId: string | null): Promise<Booking[]> {
    const brandScope = await scopedBrandIds(ctx);
    if (query.brandId && isBrandOutOfScope(brandScope, query.brandId)) throw AppError.notFound('Brand');
    const countryScope = await scopedCountryCodes(ctx);
    if (query.countryCode && isCountryOutOfScope(countryScope, query.countryCode)) {
      throw AppError.notFound('Country');
    }
    const brandIds = query.brandId ? [query.brandId] : brandScope;
    const countries = query.countryCode ? [query.countryCode] : countryScope;

    const where: Prisma.CampaignInfluencerWhereInput = {
      dealType: { in: [...PAID_DEALS] },
      participationStatus: { in: [...AGREED] },
      agreedCost: { gt: 0 },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(query.months > 0 ? { createdAt: { gte: monthsAgo(query.months) } } : {}),
      ...(brandIds ? { campaign: { brandId: { in: brandIds } } } : {}),
      ...(countries ? { influencer: { countryCode: { in: countries } } } : {}),
    };
    const rows = await prisma.campaignInfluencer.findMany({
      where,
      select: {
        id: true,
        campaignId: true,
        influencerId: true,
        agreedCost: true,
        currency: true,
        platformAtBooking: true,
        followersAtBooking: true,
        campaign: { select: { currency: true } },
        deliverables: { select: { type: true, status: true, quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
      // A generous ceiling: benchmarks read the agency's own history.
      take: 5000,
    });
    if (rows.length === 0) return [];

    const posts = await prisma.publishedContent.findMany({
      where: {
        campaignId: { in: [...new Set(rows.map((r) => r.campaignId))] },
        influencerId: { in: [...new Set(rows.map((r) => r.influencerId))] },
      },
      select: {
        campaignId: true,
        influencerId: true,
        latestSnapshot: {
          select: {
            views: true,
            likes: true,
            comments: true,
            shares: true,
            saves: true,
            reposts: true,
          },
        },
      },
    });
    const reach = new Map<string, { posts: number; views: number | null; engagements: number | null }>();
    for (const p of posts) {
      const key = `${p.campaignId}:${p.influencerId}`;
      const r = reach.get(key) ?? { posts: 0, views: null, engagements: null };
      r.posts += 1;
      const snap = p.latestSnapshot;
      if (snap?.views != null) r.views = (r.views ?? 0) + snap.views;
      const engaged = snap ? metrics.totalEngagements(snap) : null;
      if (engaged != null) r.engagements = (r.engagements ?? 0) + engaged;
      reach.set(key, r);
    }

    return rows.map((r) => {
      const fee = toMoneyNumber(r.agreedCost) ?? 0;
      const planned = r.deliverables
        .filter((d) => d.status !== 'CANCELLED' && d.type !== 'UGC')
        .reduce((n, d) => n + Math.max(1, d.quantity), 0);
      const got = reach.get(`${r.campaignId}:${r.influencerId}`);
      // No deliverables planned: count the posts they made, else one.
      const postsForFee = planned > 0 ? planned : Math.max(1, got?.posts ?? 0);
      const views = got?.views ?? null;
      const engagements = got?.engagements ?? null;
      return {
        id: r.id,
        platform: r.platformAtBooking,
        tier: followerTier(r.followersAtBooking),
        currency: (r.currency || r.campaign.currency || 'KWD').toUpperCase(),
        feePerPost: fee / postsForFee,
        costPerView: views && views > 0 ? fee / views : null,
        engagementRate: views && views > 0 && engagements != null ? (engagements / views) * 100 : null,
      };
    });
  }

  async function benchmarks(query: BenchmarkQuery): Promise<BenchmarkDTO> {
    await requireAnyCapability(ctx, ['CAMPAIGNS_VIEW', 'INFLUENCERS_VIEW']);
    const target = await resolveTarget(query);
    const moneyVisible = await hasCapability(ctx, 'FINANCE_VIEW');
    const key = `benchmarks:${ctx.actor?.id ?? 'system'}:${moneyVisible}:${JSON.stringify(query)}`;
    return memo(key, async () => {
      const all = await loadBookings(query, target.excludeId);
      const inCurrency = all.filter((b) => b.currency === query.currency);
      const others = new Map<string, number>();
      for (const b of all) if (b.currency !== query.currency) others.set(b.currency, (others.get(b.currency) ?? 0) + 1);

      const narrowed = inCurrency.filter(
        (b) => (!target.platform || b.platform === target.platform) && (!target.tier || b.tier === target.tier),
      );
      const grid: BenchmarkCellDTO[] = [];
      for (const platform of PLATFORMS) {
        for (const tier of FOLLOWER_TIERS) {
          const cell = inCurrency.filter((b) => b.platform === platform && b.tier === tier);
          if (cell.length > 0) grid.push({ platform, tier, ...stats(cell, moneyVisible) });
        }
      }

      return {
        currency: query.currency,
        months: query.months,
        since: query.months > 0 ? monthsAgo(query.months).toISOString() : null,
        minSample: BENCHMARK_MIN_SAMPLE,
        moneyVisible,
        platform: target.platform,
        tier: target.tier,
        countryCode: query.countryCode ?? null,
        overall: stats(narrowed, moneyVisible),
        grid,
        otherCurrencies: [...others.entries()]
          .map(([currency, bookings]) => ({ currency, bookings }))
          .sort((a, b) => b.bookings - a.bookings),
      };
    });
  }

  return { benchmarks };
}

export type BenchmarkService = ReturnType<typeof makeBenchmarkService>;
