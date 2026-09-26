import type { Platform, SuggestionReasonDTO } from '@influenceos/contracts';

/**
 * Suggested creators for a campaign (P3.7): plain rules, each one a reason
 * the team can read — no black box. Points add up to a match score out of
 * 100 (it becomes the candidate's fit score when they're added).
 */

/** Less of their audience than this in the campaign's countries doesn't count. */
export const AUDIENCE_MIN_PCT = 10;
export const ENGAGEMENT_GOOD = 3;
export const ENGAGEMENT_GREAT = 5;

export interface SuggestionInput {
  countryCode: string | null;
  /** Each account: its platform, engagement rate and latest audience shares in the campaign's countries. */
  accounts: {
    platform: Platform;
    engagementRate: number | null;
    marketShares: { countryCode: string; pct: number }[];
  }[];
  /** Campaigns done with this brand before. */
  collaborationsWithBrand: number;
}

export interface SuggestionContext {
  /** The campaign's countries. */
  markets: string[];
  /** Platforms the campaign's deliverables are on. */
  platforms: Platform[];
}

export function scoreSuggestion(
  input: SuggestionInput,
  context: SuggestionContext,
): { score: number; reasons: SuggestionReasonDTO[] } {
  const reasons: SuggestionReasonDTO[] = [];
  let score = 0;

  // Audience in the campaign's countries: the account with the most of it.
  let bestShare = 0;
  let bestTop: { countryCode: string; pct: number } | null = null;
  for (const a of input.accounts) {
    const total = a.marketShares.reduce((n, s) => n + s.pct, 0);
    if (total > bestShare) {
      bestShare = total;
      bestTop = [...a.marketShares].sort((x, y) => y.pct - x.pct)[0] ?? null;
    }
  }
  bestShare = Math.min(100, bestShare);
  if (bestShare >= AUDIENCE_MIN_PCT) {
    score += Math.min(35, Math.round(bestShare * 0.5));
    reasons.push({
      code: 'AUDIENCE_IN_MARKET',
      pct: Math.round(bestShare),
      countryCode: context.markets.length === 1 ? (bestTop?.countryCode ?? null) : null,
    });
  }

  if (input.countryCode && context.markets.includes(input.countryCode)) {
    score += 15;
    reasons.push({ code: 'BASED_IN_MARKET', countryCode: input.countryCode });
  }

  if (input.collaborationsWithBrand > 0) {
    score += 15 + Math.min(5, input.collaborationsWithBrand);
    reasons.push({ code: 'WORKED_WITH_BRAND', campaigns: input.collaborationsWithBrand });
  }

  const er = Math.max(-1, ...input.accounts.map((a) => a.engagementRate ?? -1));
  if (er >= ENGAGEMENT_GOOD) {
    score += er >= ENGAGEMENT_GREAT ? 15 : 10;
    reasons.push({ code: 'HIGH_ENGAGEMENT', pct: Math.round(er * 10) / 10 });
  }

  const onPlatform = context.platforms.find((p) => input.accounts.some((a) => a.platform === p));
  if (onPlatform) {
    score += 10;
    reasons.push({ code: 'PLATFORM_MATCH', platform: onPlatform });
  }

  return { score: Math.min(100, score), reasons };
}
