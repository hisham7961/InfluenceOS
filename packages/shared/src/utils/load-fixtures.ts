import { RELATIONSHIP_STATUSES, type RelationshipStatus } from '../constants/enums';
import { normalizeCountryToCode } from '../constants/countries';

/**
 * Deterministic fixture generators for the W7-3 load/scale seed. Pure (no DB, no
 * randomness) so the same index always yields the same row — reproducible load
 * runs, and unit-testable. `LOAD_SEED_MARKER` tags every generated row so the
 * seed is idempotent (re-runs detect existing load rows) and the load data can
 * be found and removed without touching real records.
 */

export const LOAD_SEED_MARKER = 'load-seed';

const COUNTRIES = ['Kuwait', 'Saudi Arabia', 'UAE', 'Qatar', 'Bahrain', 'Oman', 'Egypt', 'Jordan'] as const;
const CATEGORIES = ['Fashion', 'Beauty', 'Food', 'Tech', 'Fitness', 'Travel', 'Gaming', 'Lifestyle', 'Parenting', 'Finance'] as const;

export interface LoadInfluencerRow {
  displayName: string;
  fullName: string;
  primaryUsername: string;
  country: string;
  countryCode: string;
  category: string;
  relationshipStatus: RelationshipStatus;
  internalNotes: string;
}

/** A page of `count` influencer rows starting at `startIndex` (deterministic). */
export function buildLoadInfluencers(count: number, startIndex = 0): LoadInfluencerRow[] {
  const rows: LoadInfluencerRow[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = startIndex + k;
    const country = COUNTRIES[i % COUNTRIES.length]!;
    rows.push({
      displayName: `Load Creator ${i}`,
      fullName: `Load Creator Full Name ${i}`,
      primaryUsername: `load_creator_${i}`,
      country,
      countryCode: normalizeCountryToCode(country)!,
      category: CATEGORIES[i % CATEGORIES.length]!,
      relationshipStatus: RELATIONSHIP_STATUSES[i % RELATIONSHIP_STATUSES.length]!,
      internalNotes: LOAD_SEED_MARKER,
    });
  }
  return rows;
}

/** A page of `count` campaign names starting at `startIndex` (deterministic). */
export function buildLoadCampaignNames(count: number, startIndex = 0): string[] {
  return Array.from({ length: count }, (_, k) => `Load Campaign ${startIndex + k}`);
}
