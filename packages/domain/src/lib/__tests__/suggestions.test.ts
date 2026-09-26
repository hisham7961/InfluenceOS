import { describe, expect, it } from 'vitest';
import { scoreSuggestion } from '../suggestions';

const kw = { markets: ['KW'], platforms: ['INSTAGRAM' as const] };

describe('suggested creators (P3.7)', () => {
  it('adds up the reasons, each one readable', () => {
    const r = scoreSuggestion(
      {
        countryCode: 'KW',
        accounts: [
          { platform: 'INSTAGRAM', engagementRate: 5.5, marketShares: [{ countryCode: 'KW', pct: 60 }] },
          { platform: 'TIKTOK', engagementRate: 2, marketShares: [{ countryCode: 'KW', pct: 20 }] },
        ],
        collaborationsWithBrand: 2,
      },
      kw,
    );
    // 30 (audience) + 15 (based in) + 17 (brand) + 15 (engagement) + 10 (platform)
    expect(r.score).toBe(87);
    expect(r.reasons).toEqual([
      { code: 'AUDIENCE_IN_MARKET', pct: 60, countryCode: 'KW' },
      { code: 'BASED_IN_MARKET', countryCode: 'KW' },
      { code: 'WORKED_WITH_BRAND', campaigns: 2 },
      { code: 'HIGH_ENGAGEMENT', pct: 5.5 },
      { code: 'PLATFORM_MATCH', platform: 'INSTAGRAM' },
    ]);
  });

  it('adds shares across several campaign countries and names none', () => {
    const r = scoreSuggestion(
      {
        countryCode: 'EG',
        accounts: [
          {
            platform: 'TIKTOK',
            engagementRate: null,
            marketShares: [
              { countryCode: 'KW', pct: 30 },
              { countryCode: 'SA', pct: 40 },
            ],
          },
        ],
        collaborationsWithBrand: 0,
      },
      { markets: ['KW', 'SA'], platforms: [] },
    );
    expect(r).toEqual({ score: 35, reasons: [{ code: 'AUDIENCE_IN_MARKET', pct: 70, countryCode: null }] });
  });

  it('ignores a small audience share and a middling engagement rate', () => {
    const r = scoreSuggestion(
      {
        countryCode: 'SA',
        accounts: [{ platform: 'YOUTUBE', engagementRate: 2.9, marketShares: [{ countryCode: 'KW', pct: 8 }] }],
        collaborationsWithBrand: 0,
      },
      kw,
    );
    expect(r).toEqual({ score: 0, reasons: [] });
  });
});
