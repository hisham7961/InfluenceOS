import { Prisma } from '@influenceos/database';
import { metrics } from '@influenceos/shared';
import type { CampaignInfluencerResultsDTO } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { toDecimal } from './money';
import { isRepeatedFee, participationMoney, rosterFeeIds, type ParticipationMoneyRow } from './spend';

/** A post that is no longer up doesn't count as live. */
const GONE = new Set(['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK']);

type RosterRow = ParticipationMoneyRow & {
  id: string;
  influencerId: string;
  deliverables: { type: string; status: string; quantity: number }[];
};

export interface CampaignPostMetrics {
  id: string;
  influencerId: string | null;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  live: boolean;
}

export interface CreatorResults {
  /** Per roster row (campaign-influencer id). */
  byRosterRow: Map<string, CampaignInfluencerResultsDTO>;
  /** Every post on the campaign with its latest numbers — for per-post cost. */
  posts: CampaignPostMetrics[];
  /** Spend that isn't tied to any one creator (campaign-level expenses). */
  unattributedSpend: number;
}

const zero = () => new Prisma.Decimal(0);

/**
 * Each creator's results on one campaign: their posts (live vs planned), the
 * latest views and engagements on those posts, and what they cost — their
 * own fee plus the expenses recorded against them — so cost per view and per
 * engagement reflect what that creator was actually paid. (The campaign-wide
 * figure used to be split evenly, so a 3,000 KWD creator looked as cheap as a
 * 100 KWD one.) Same money rules as the campaign total (spend.ts): gift
 * purchases aren't spend, and a fee entered twice counts once. Three queries
 * for the whole roster.
 */
export async function loadCreatorResults(
  prisma: DomainContext['prisma'],
  campaignId: string,
  roster: RosterRow[],
): Promise<CreatorResults> {
  const [posts, expenses] = await Promise.all([
    prisma.publishedContent.findMany({
      where: { campaignId },
      select: {
        id: true,
        influencerId: true,
        availabilityStatus: true,
        metricSnapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { views: true, likes: true, comments: true, shares: true, saves: true, reposts: true, engagementRate: true },
        },
      },
    }),
    prisma.campaignExpense.findMany({
      where: { campaignId, deletedAt: null },
      select: { campaignInfluencerId: true, type: true, amount: true, paymentStatus: true, paidAmount: true },
    }),
  ]);

  const postMetrics: CampaignPostMetrics[] = posts.map((p) => {
    const snap = p.metricSnapshots[0] ?? null;
    return {
      id: p.id,
      influencerId: p.influencerId,
      views: snap?.views ?? null,
      engagements: snap ? metrics.totalEngagements(snap) : null,
      engagementRate: snap?.engagementRate ?? null,
      live: !GONE.has(p.availabilityStatus),
    };
  });

  const rosterFees = rosterFeeIds(roster);
  const spendByRow = new Map<string, Prisma.Decimal>();
  for (const ci of roster) spendByRow.set(ci.id, participationMoney(ci).fee);
  let unattributed = zero();
  for (const e of expenses) {
    if (isRepeatedFee(e, rosterFees) || e.type === 'GIFT_PRODUCT') continue;
    const amount = toDecimal(e.amount) ?? zero();
    const row = e.campaignInfluencerId ? spendByRow.get(e.campaignInfluencerId) : undefined;
    if (row && e.campaignInfluencerId) spendByRow.set(e.campaignInfluencerId, row.plus(amount));
    else unattributed = unattributed.plus(amount);
  }

  const byRosterRow = new Map<string, CampaignInfluencerResultsDTO>();
  for (const ci of roster) {
    const mine = postMetrics.filter((p) => p.influencerId === ci.influencerId);
    let views = 0;
    let viewsKnown = false;
    let engagements = 0;
    let engagementsKnown = false;
    let withMetrics = 0;
    let erSum = 0;
    let erCount = 0;
    for (const p of mine) {
      if (p.views != null || p.engagements != null || p.engagementRate != null) withMetrics += 1;
      if (p.views != null) {
        views += p.views;
        viewsKnown = true;
      }
      if (p.engagements != null) {
        engagements += p.engagements;
        engagementsKnown = true;
      }
      if (p.engagementRate != null) {
        erSum += p.engagementRate;
        erCount += 1;
      }
    }
    const spend = (spendByRow.get(ci.id) ?? zero()).toNumber();
    const totalViews = viewsKnown ? views : null;
    const totalEngagements = engagementsKnown ? engagements : null;
    const planned = ci.deliverables
      .filter((d) => d.status !== 'CANCELLED' && d.type !== 'UGC')
      .reduce((n, d) => n + Math.max(1, d.quantity), 0);
    byRosterRow.set(ci.id, {
      postsLive: mine.filter((p) => p.live).length,
      postsTotal: mine.length,
      postsPlanned: planned,
      postsWithMetrics: withMetrics,
      views: totalViews,
      engagements: totalEngagements,
      // Engagements over views when both are known; else the average rate the posts reported.
      engagementRate:
        totalViews && totalEngagements != null
          ? (totalEngagements / totalViews) * 100
          : erCount > 0
            ? erSum / erCount
            : null,
      spend,
      costPerView: spend > 0 ? metrics.costPerView(spend, totalViews) : null,
      costPerEngagement: spend > 0 ? metrics.costPerEngagement(spend, totalEngagements) : null,
    });
  }

  return { byRosterRow, posts: postMetrics, unattributedSpend: unattributed.toNumber() };
}

/**
 * Estimated cost per view of one post: the creator's spend shared across
 * their own posts on the campaign (campaign-level costs shared across posts
 * with no creator), over the post's views.
 */
export function postCostPerView(
  post: CampaignPostMetrics,
  results: CreatorResults,
  rosterRowByInfluencer: Map<string, string>,
): number | null {
  if (post.views == null || post.views <= 0) return null;
  if (post.influencerId) {
    const rowId = rosterRowByInfluencer.get(post.influencerId);
    const r = rowId ? results.byRosterRow.get(rowId) : undefined;
    if (!r || r.spend <= 0 || r.postsTotal === 0) return null;
    return r.spend / r.postsTotal / post.views;
  }
  const orphans = results.posts.filter((p) => !p.influencerId).length;
  if (results.unattributedSpend <= 0 || orphans === 0) return null;
  return results.unattributedSpend / orphans / post.views;
}
