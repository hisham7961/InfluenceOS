import type { LicenceCheckState } from '@influenceos/contracts';

/**
 * Creator advertising licences (P3.5). A campaign aimed at a country on the
 * "needs a licence" list (Settings → Compliance) checks each creator on its
 * roster for a licence there that is still valid for the whole campaign.
 * The rule lives here so the roster, Needs Attention and the reminders all
 * say the same thing.
 */

/** A licence counts as "expiring soon" this many days before it ends. */
export const LICENCE_SOON_DAYS = 30;
const DAY = 864e5;

/** Roster statuses whose creators are checked (still working on the campaign). */
export const LICENCE_CHECKED_STATUSES = ['INVITED', 'CONFIRMED', 'IN_PROGRESS'] as const;
/** Of those, the ones Needs Attention raises: the creator has agreed to post. */
export const LICENCE_ALERT_STATUSES = ['CONFIRMED', 'IN_PROGRESS'] as const;
/** Campaign statuses whose rosters are checked. */
export const LICENCE_CAMPAIGN_STATUSES = ['PLANNING', 'ACTIVE', 'PAUSED'] as const;

/** The campaign's countries that need a licence, in the campaign's own order. */
export function countriesToCheck(
  markets: readonly string[],
  required: readonly string[],
): string[] {
  const need = new Set(required);
  return [...new Set(markets)].filter((c) => need.has(c));
}

/**
 * One creator, one country. No licence → MISSING; ended → EXPIRED; ends
 * before the campaign does (or within 30 days when the campaign has no end
 * date) → EXPIRES_DURING. A licence with no expiry date recorded is VALID.
 */
export function licenceState(
  licence: { expiresAt: Date | null } | undefined,
  campaignEnd: Date | null,
  now: Date = new Date(),
): LicenceCheckState {
  if (!licence) return 'MISSING';
  if (!licence.expiresAt) return 'VALID';
  if (licence.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  const until =
    campaignEnd && campaignEnd > now
      ? campaignEnd
      : new Date(now.getTime() + LICENCE_SOON_DAYS * DAY);
  return licence.expiresAt < until ? 'EXPIRES_DURING' : 'VALID';
}

/** Every checked country for one creator. */
export function checkCreator<L extends { countryCode: string; expiresAt: Date | null }>(
  countries: readonly string[],
  licences: readonly L[],
  campaignEnd: Date | null,
  now: Date = new Date(),
): { countryCode: string; state: LicenceCheckState; licence: L | undefined }[] {
  const byCountry = new Map(licences.map((l) => [l.countryCode, l]));
  return countries.map((countryCode) => {
    const licence = byCountry.get(countryCode);
    return { countryCode, state: licenceState(licence, campaignEnd, now), licence };
  });
}

/** How a licence reads on its own (the creator's page): valid, expiring soon, or expired. */
export function licenceStatus(
  expiresAt: Date | null,
  now: Date = new Date(),
): { status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED'; daysLeft: number | null } {
  if (!expiresAt) return { status: 'VALID', daysLeft: null };
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
  if (expiresAt.getTime() <= now.getTime()) return { status: 'EXPIRED', daysLeft };
  return { status: daysLeft <= LICENCE_SOON_DAYS ? 'EXPIRING_SOON' : 'VALID', daysLeft };
}
