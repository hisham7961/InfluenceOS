// Pure usage-rights helpers shared by the API/domain layer, the worker
// (license-expiry alerts) and clients — no Prisma, no framework code (W3-2).
import {
  USAGE_RIGHT_EXPIRY_WARNING_DAYS,
  type UsageRightEffectiveStatus,
  type UsageRightStatus,
} from '../constants/enums';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from `now` until `expiresAt`, rounded UP so a license with any
 * time left today reads as at least 1 day and a lapsed one reads negative.
 * `null` when there is no expiry (a perpetual license).
 */
export function daysUntilExpiry(expiresAt: Date | null | undefined, now: Date = new Date()): number | null {
  if (expiresAt == null) return null;
  return Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Derive the effective (never-stored) status shown to users and used to drive
 * expiry alerts. A REVOKED/EXPIRED stored status is authoritative. An ACTIVE
 * license is EXPIRED once its `expiresAt` has passed, EXPIRING_SOON when it
 * falls inside the warning window, otherwise ACTIVE. A license with no expiry
 * is always ACTIVE. `warningDays` is the alert lead time (default 14).
 */
export function computeUsageRightEffectiveStatus(
  stored: UsageRightStatus,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
  warningDays: number = USAGE_RIGHT_EXPIRY_WARNING_DAYS,
): UsageRightEffectiveStatus {
  if (stored === 'REVOKED') return 'REVOKED';
  if (stored === 'EXPIRED') return 'EXPIRED';
  // stored === 'ACTIVE'
  const days = daysUntilExpiry(expiresAt, now);
  if (days == null) return 'ACTIVE';
  if (days < 0) return 'EXPIRED';
  if (days <= warningDays) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

/**
 * True when an ACTIVE license is inside its expiry-warning window (and has not
 * already lapsed) — the exact condition the worker alerts on.
 */
export function isUsageRightExpiringSoon(
  stored: UsageRightStatus,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
  warningDays: number = USAGE_RIGHT_EXPIRY_WARNING_DAYS,
): boolean {
  return computeUsageRightEffectiveStatus(stored, expiresAt, now, warningDays) === 'EXPIRING_SOON';
}
