import { describe, expect, it } from 'vitest';
import { LOAD_SEED_MARKER, buildLoadCampaignNames, buildLoadInfluencers } from '../utils/load-fixtures';

describe('load fixtures (W7-3)', () => {
  it('generates the requested count, deterministically and uniquely', () => {
    const a = buildLoadInfluencers(1000);
    const b = buildLoadInfluencers(1000);
    expect(a).toHaveLength(1000);
    expect(a).toEqual(b); // pure — same output every run
    expect(new Set(a.map((r) => r.primaryUsername)).size).toBe(1000); // unique handles
    expect(a.every((r) => r.internalNotes === LOAD_SEED_MARKER)).toBe(true); // tagged for cleanup
  });

  it('pages without overlap via startIndex', () => {
    const first = buildLoadInfluencers(500, 0);
    const second = buildLoadInfluencers(500, 500);
    const names = new Set([...first, ...second].map((r) => r.displayName));
    expect(names.size).toBe(1000); // no collision across pages
    expect(second[0]!.displayName).toBe('Load Creator 500');
  });

  it('spreads country/category/relationship across the row set', () => {
    const rows = buildLoadInfluencers(200);
    expect(new Set(rows.map((r) => r.country)).size).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.category)).size).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.relationshipStatus)).size).toBeGreaterThan(1);
  });

  it('generates matching campaign names', () => {
    expect(buildLoadCampaignNames(3, 10)).toEqual(['Load Campaign 10', 'Load Campaign 11', 'Load Campaign 12']);
  });
});
