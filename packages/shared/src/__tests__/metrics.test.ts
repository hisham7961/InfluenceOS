import { describe, expect, it } from 'vitest';
import {
  costPerView,
  cpm,
  engagementRate,
  completionRate,
  totalEngagements,
} from '../metrics/performance';
import { assessAudienceHealth } from '../metrics/audience-health';

describe('performance calculations', () => {
  it('never fabricates from missing data', () => {
    expect(costPerView(null, 1000)).toBeNull();
    expect(costPerView(100, 0)).toBeNull();
    expect(cpm(100, null)).toBeNull();
    expect(totalEngagements({})).toBeNull();
  });

  it('computes engagement rate against views', () => {
    const er = engagementRate({ likes: 60, comments: 4, shares: 0, saves: 0 }, { views: 1000 });
    expect(er).toBeCloseTo(6.4, 5);
  });

  it('falls back to followers when views are absent', () => {
    const er = engagementRate({ likes: 100, comments: 0 }, { followers: 10000 });
    expect(er).toBeCloseTo(1, 5);
  });

  it('computes CPV, CPM and completion', () => {
    expect(costPerView(50, 1000)).toBeCloseTo(0.05, 5);
    expect(cpm(50, 1000)).toBeCloseTo(50, 5);
    expect(completionRate(12, 18)).toBeCloseTo(66.6667, 3);
  });
});

describe('audience health', () => {
  it('returns LIMITED_DATA without enough history', () => {
    expect(assessAudienceHealth({ followerHistory: [] }).label).toBe('LIMITED_DATA');
  });

  it('flags a sudden abnormal spike as REVIEW', () => {
    const now = Date.now();
    const history = [
      { followers: 10000, capturedAt: new Date(now - 3 * 864e5) },
      { followers: 10200, capturedAt: new Date(now - 2 * 864e5) },
      { followers: 16000, capturedAt: new Date(now - 1 * 864e5) },
    ];
    const r = assessAudienceHealth({ followerHistory: history, engagementRate: 2 });
    expect(r.label).toBe('REVIEW');
    expect(r.signals.some((s) => s.key === 'growth_spike')).toBe(true);
  });

  it('labels steady growth + good engagement as HEALTHY', () => {
    const now = Date.now();
    const history = Array.from({ length: 6 }, (_, i) => ({
      followers: 10000 + i * 500,
      capturedAt: new Date(now - (6 - i) * 864e5),
    }));
    const r = assessAudienceHealth({ followerHistory: history, engagementRate: 3.2 });
    expect(r.label).toBe('HEALTHY');
  });
});
