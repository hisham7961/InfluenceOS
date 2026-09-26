/**
 * Follower tiers (P3.7) — how agencies group creators by size when they
 * compare rates: nano under 10K, micro 10K–100K, mid 100K–500K, macro
 * 500K–1M, mega 1M and up.
 */
export const FOLLOWER_TIERS = ['NANO', 'MICRO', 'MID', 'MACRO', 'MEGA'] as const;
export type FollowerTier = (typeof FOLLOWER_TIERS)[number];

/** Each tier's follower range: `min` inclusive, `max` exclusive (null = no top). */
export const FOLLOWER_TIER_RANGES: Record<FollowerTier, { min: number; max: number | null }> = {
  NANO: { min: 0, max: 10_000 },
  MICRO: { min: 10_000, max: 100_000 },
  MID: { min: 100_000, max: 500_000 },
  MACRO: { min: 500_000, max: 1_000_000 },
  MEGA: { min: 1_000_000, max: null },
};

export function followerTier(followers: number | null | undefined): FollowerTier | null {
  if (followers == null || followers < 0) return null;
  for (const tier of FOLLOWER_TIERS) {
    const { max } = FOLLOWER_TIER_RANGES[tier];
    if (max == null || followers < max) return tier;
  }
  return 'MEGA';
}

/** Look-back windows for rate benchmarks, in months (0 = all time). */
export const BENCHMARK_MONTHS = [3, 6, 12, 24, 0] as const;
