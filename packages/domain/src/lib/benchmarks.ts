import type { Platform } from '@influenceos/contracts';

/**
 * Rate benchmarks (P3.7): the middle of what similar creators were paid, and
 * the range the middle half of them fall in — so a fee can be judged against
 * past bookings rather than memory.
 */

/** Fewer bookings than this and a figure is not shown (one or two fees are not a benchmark). */
export const BENCHMARK_MIN_SAMPLE = 3;

export interface Spread {
  median: number;
  /** A quarter of the bookings are at or below this… */
  p25: number;
  /** …and three quarters at or below this. */
  p75: number;
  sampleSize: number;
}

/** The q-th quantile (0–1) of ascending values, interpolating between neighbours. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

/**
 * Median and middle-half range of the known, finite values — or null when
 * there are fewer than `minSample` of them.
 */
export function summarize(
  values: readonly (number | null | undefined)[],
  minSample = BENCHMARK_MIN_SAMPLE,
): Spread | null {
  const known = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (known.length === 0 || known.length < minSample) return null;
  return {
    median: quantile(known, 0.5),
    p25: quantile(known, 0.25),
    p75: quantile(known, 0.75),
    sampleSize: known.length,
  };
}

export interface AccountForPick {
  platform: Platform;
  followers: number | null;
  isPrimary: boolean;
}

/**
 * A creator's main account: the one on their main platform, else the one
 * marked primary, else the one with the most followers. (Same order as the
 * booking-snapshot backfill in migration 20261005090000_booking_snapshot.)
 */
export function mainAccount<T extends AccountForPick>(
  accounts: readonly T[],
  primaryPlatform: Platform | null | undefined,
): T | null {
  if (accounts.length === 0) return null;
  const rank = (a: T) => [
    primaryPlatform && a.platform === primaryPlatform ? 1 : 0,
    a.isPrimary ? 1 : 0,
    a.followers ?? -1,
  ];
  return [...accounts].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i]! - ra[i]!;
    return 0;
  })[0]!;
}
