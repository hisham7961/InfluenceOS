import type { Prisma } from '@influenceos/database';
import type { Platform } from '@influenceos/contracts';
import { businessDateKey, metrics } from '@influenceos/shared';
import type { DomainContext } from '../context';

/**
 * Posts with their latest numbers, for trends and performance (P2.7). A
 * post's date is when it went up (publishedAt), or when we first saw it if
 * that's unknown — the same rule the content wall uses.
 */
export interface PostMetricRow {
  id: string;
  influencerId: string | null;
  brandId: string | null;
  campaignId: string | null;
  platform: Platform;
  /** Kuwait day it went up (YYYY-MM-DD). */
  day: string;
  postedAt: Date;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
}

/** Posts that went up in [from, to). */
export function postedBetween(from: Date, to: Date): Prisma.PublishedContentWhereInput {
  return {
    OR: [
      { publishedAt: { gte: from, lt: to } },
      { publishedAt: null, detectedAt: { gte: from, lt: to } },
    ],
  };
}

export async function loadPostMetrics(
  prisma: DomainContext['prisma'],
  where: Prisma.PublishedContentWhereInput,
  take = 20_000,
): Promise<PostMetricRow[]> {
  const rows = await prisma.publishedContent.findMany({
    where,
    select: {
      id: true,
      influencerId: true,
      brandId: true,
      campaignId: true,
      platform: true,
      publishedAt: true,
      detectedAt: true,
      metricSnapshots: {
        orderBy: { capturedAt: 'desc' },
        take: 1,
        select: { views: true, likes: true, comments: true, shares: true, saves: true, reposts: true, engagementRate: true },
      },
    },
    take,
  });
  return rows.map((r) => {
    const snap = r.metricSnapshots[0] ?? null;
    const postedAt = r.publishedAt ?? r.detectedAt;
    const views = snap?.views ?? null;
    const engagements = snap ? metrics.totalEngagements(snap) : null;
    // A percentage, like the stored snapshot value (3.5 = 3.5%).
    const engagementRate =
      snap?.engagementRate ?? (views && engagements != null && views > 0 ? (engagements / views) * 100 : null);
    return {
      id: r.id,
      influencerId: r.influencerId,
      brandId: r.brandId,
      campaignId: r.campaignId,
      platform: r.platform,
      day: businessDateKey(postedAt),
      postedAt,
      views,
      engagements,
      engagementRate,
    };
  });
}

/** Sum of the known values, or null when none is known. */
export function sumKnown(values: (number | null)[]): number | null {
  let total = 0;
  let known = false;
  for (const v of values) {
    if (v == null) continue;
    total += v;
    known = true;
  }
  return known ? total : null;
}
