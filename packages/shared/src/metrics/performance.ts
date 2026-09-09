/**
 * Performance calculations (spec §24). Every function returns `null` when the
 * required inputs are missing or a denominator is zero — we NEVER compute a
 * metric from fabricated or partial data. The `FORMULAS` map powers the
 * calculation tooltips shown in the UI.
 */

export const FORMULAS = {
  engagementRate: 'Engagement Rate = (Likes + Comments + Shares + Saves) ÷ Reach × 100',
  costPerView: 'Cost Per View = Cost ÷ Views',
  cpm: 'CPM = Cost ÷ Views × 1000',
  costPerEngagement: 'Cost Per Engagement = Cost ÷ Total Engagements',
  viewsPerFollower: 'Views per Follower = Views ÷ Followers',
  completionRate: 'Completion Rate = Published Deliverables ÷ Total Deliverables × 100',
} as const;

type Num = number | null | undefined;

function isNum(v: Num): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function safeDiv(numerator: Num, denominator: Num): number | null {
  if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export interface EngagementInput {
  likes?: Num;
  comments?: Num;
  shares?: Num;
  saves?: Num;
  reposts?: Num;
}

/** Sum available engagement signals; returns null if none are present. */
export function totalEngagements(input: EngagementInput): number | null {
  const parts = [input.likes, input.comments, input.shares, input.saves, input.reposts].filter(
    isNum,
  );
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * Engagement rate as a percentage. Prefers reach/views as the denominator;
 * falls back to follower count. Returns null when neither is available.
 */
export function engagementRate(
  input: EngagementInput,
  opts: { views?: Num; followers?: Num },
): number | null {
  const eng = totalEngagements(input);
  const denom = isNum(opts.views) && opts.views > 0 ? opts.views : opts.followers;
  const rate = safeDiv(eng, denom);
  return rate == null ? null : rate * 100;
}

export function costPerView(cost: Num, views: Num): number | null {
  return safeDiv(cost, views);
}

export function cpm(cost: Num, views: Num): number | null {
  const perView = safeDiv(cost, views);
  return perView == null ? null : perView * 1000;
}

export function costPerEngagement(cost: Num, engagements: Num): number | null {
  return safeDiv(cost, engagements);
}

export function viewsPerFollower(views: Num, followers: Num): number | null {
  return safeDiv(views, followers);
}

export function completionRate(published: Num, total: Num): number | null {
  const r = safeDiv(published, total);
  return r == null ? null : r * 100;
}
