import { describe, expect, it } from 'vitest';
import { followerTier } from '../utils/follower-tiers';

describe('followerTier', () => {
  it('groups creators by size, with each boundary starting the next tier', () => {
    expect(followerTier(0)).toBe('NANO');
    expect(followerTier(9_999)).toBe('NANO');
    expect(followerTier(10_000)).toBe('MICRO');
    expect(followerTier(99_999)).toBe('MICRO');
    expect(followerTier(100_000)).toBe('MID');
    expect(followerTier(500_000)).toBe('MACRO');
    expect(followerTier(1_000_000)).toBe('MEGA');
    expect(followerTier(25_000_000)).toBe('MEGA');
  });
  it('has no tier without a follower count', () => {
    expect(followerTier(null)).toBeNull();
    expect(followerTier(undefined)).toBeNull();
  });
});
