import {
  requests,
  type CreatorLeaderboardDTO,
  type CreatorTier,
  type LeaderboardEntryDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { moneyNumberOr0, sumMoney } from '../lib/money';
import { scopedBrandIds } from '../lib/scope';

type LeaderboardQuery = z.infer<typeof requests.leaderboardQuerySchema>;

// A collaboration only counts once committed — an invited/declined/dropped
// participation never inflates a creator's standing (consistent with DB-10).
const COMMITTED = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;
// A deliverable counts as delivered once it reaches a published/verified/
// approved state (UGC completes via approval, W3-1).
const PUBLISHED = ['PUBLISHED', 'VERIFIED', 'APPROVED'] as const;

/** Deterministic performance score and tier from delivered work (W6-2). */
function tierFor(published: number): CreatorTier {
  if (published >= 8) return 'GOLD';
  if (published >= 3) return 'SILVER';
  if (published >= 1) return 'BRONZE';
  return 'NEW';
}

export function makeAnalyticsService(ctx: DomainContext) {
  const { prisma } = ctx;

  /**
   * Creator performance leaderboard (W6-2). Ranks creators by delivered work so
   * "who are our strongest / weakest creators?" is answerable. Server-computed
   * (no browser math). Respects the caller's brand scope (W4-4) and an optional
   * brand filter.
   */
  async function creatorLeaderboard(query: LeaderboardQuery): Promise<CreatorLeaderboardDTO> {
    const scope = await scopedBrandIds(ctx);
    const brandFilter: Prisma.CampaignWhereInput = {
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(scope ? { brandId: { in: scope } } : {}),
    };

    const rows = await prisma.campaignInfluencer.findMany({
      where: {
        participationStatus: { in: [...COMMITTED] },
        campaign: brandFilter,
      },
      select: {
        influencerId: true,
        agreedCost: true,
        dealType: true,
        paymentStatus: true,
        influencer: {
          select: { displayName: true, primaryUsername: true, category: true, avatarOverrideUrl: true, resolvedAvatarUrl: true },
        },
        campaign: { select: { brandId: true } },
        deliverables: { select: { status: true } },
      },
      take: 5000,
    });

    type Acc = {
      influencerId: string;
      displayName: string;
      primaryUsername: string | null;
      avatarUrl: string | null;
      category: string | null;
      campaigns: number;
      brands: Set<string>;
      deliverablesTotal: number;
      deliverablesPublished: number;
      paid: Prisma.Decimal[];
    };
    const byInfluencer = new Map<string, Acc>();

    for (const r of rows) {
      let acc = byInfluencer.get(r.influencerId);
      if (!acc) {
        acc = {
          influencerId: r.influencerId,
          displayName: r.influencer.displayName,
          primaryUsername: r.influencer.primaryUsername,
          avatarUrl: r.influencer.avatarOverrideUrl ?? r.influencer.resolvedAvatarUrl ?? null,
          category: r.influencer.category,
          campaigns: 0,
          brands: new Set<string>(),
          deliverablesTotal: 0,
          deliverablesPublished: 0,
          paid: [],
        };
        byInfluencer.set(r.influencerId, acc);
      }
      acc.campaigns += 1;
      acc.brands.add(r.campaign.brandId);
      acc.deliverablesTotal += r.deliverables.length;
      acc.deliverablesPublished += r.deliverables.filter((d) => (PUBLISHED as readonly string[]).includes(d.status)).length;
      if ((r.dealType === 'PAID' || r.dealType === 'PAID_PLUS_GIFTED') && r.paymentStatus === 'PAID' && r.agreedCost != null) {
        acc.paid.push(new Prisma.Decimal(r.agreedCost));
      }
    }

    const entries: LeaderboardEntryDTO[] = [...byInfluencer.values()].map((a) => {
      const repeatCollaborations = Math.max(0, a.campaigns - 1);
      const score = a.deliverablesPublished * 10 + a.campaigns * 5 + repeatCollaborations * 3;
      return {
        influencerId: a.influencerId,
        displayName: a.displayName,
        primaryUsername: a.primaryUsername,
        avatarUrl: a.avatarUrl,
        category: a.category,
        campaigns: a.campaigns,
        brands: a.brands.size,
        repeatCollaborations,
        deliverablesTotal: a.deliverablesTotal,
        deliverablesPublished: a.deliverablesPublished,
        completionRate: a.deliverablesTotal > 0 ? a.deliverablesPublished / a.deliverablesTotal : null,
        totalPaid: a.paid.length ? moneyNumberOr0(sumMoney(a.paid)) : null,
        tier: tierFor(a.deliverablesPublished),
        score,
      };
    });

    entries.sort(
      (x, y) => y.score - x.score || y.deliverablesPublished - x.deliverablesPublished || x.displayName.localeCompare(y.displayName),
    );

    return { entries: entries.slice(0, query.limit), generatedAt: new Date().toISOString() };
  }

  return { creatorLeaderboard };
}

export type AnalyticsService = ReturnType<typeof makeAnalyticsService>;
