import { describe, expect, it } from 'vitest';
import { mainAccount, quantile, summarize } from '../benchmarks';

describe('rate benchmarks (P3.7)', () => {
  it('quantiles interpolate between neighbours', () => {
    expect(quantile([10], 0.5)).toBe(10);
    expect(quantile([10, 20], 0.5)).toBe(15);
    expect(quantile([100, 200, 300, 400], 0.25)).toBe(175);
    expect(quantile([100, 200, 300, 400], 0.75)).toBe(325);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('summarizes known values only, and needs a minimum sample', () => {
    expect(summarize([400, null, 100, undefined, 300, 200, Number.NaN])).toEqual({
      median: 250,
      p25: 175,
      p75: 325,
      sampleSize: 4,
    });
    expect(summarize([100, 200])).toBeNull();
    expect(summarize([100, 200], 1)).toMatchObject({ median: 150, sampleSize: 2 });
    expect(summarize([])).toBeNull();
  });

  it("picks the creator's main account: main platform, then primary, then biggest", () => {
    const ig = { platform: 'INSTAGRAM' as const, followers: 50_000, isPrimary: false };
    const tt = { platform: 'TIKTOK' as const, followers: 900_000, isPrimary: false };
    const sc = { platform: 'SNAPCHAT' as const, followers: null, isPrimary: true };
    expect(mainAccount([ig, tt, sc], 'INSTAGRAM')).toBe(ig);
    expect(mainAccount([ig, tt, sc], null)).toBe(sc);
    expect(mainAccount([ig, tt], null)).toBe(tt);
    expect(mainAccount([], 'INSTAGRAM')).toBeNull();
  });
});
