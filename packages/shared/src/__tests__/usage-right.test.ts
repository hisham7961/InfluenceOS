import { describe, expect, it } from 'vitest';
import {
  computeUsageRightEffectiveStatus,
  daysUntilExpiry,
  isUsageRightExpiringSoon,
} from '../utils/usage-right';

/**
 * W3-2 — pure usage-rights derivation shared by the API/domain, the worker
 * (license-expiry alerts) and clients. The stored status is authoritative for
 * REVOKED/EXPIRED; an ACTIVE license is EXPIRED once past `expiresAt`,
 * EXPIRING_SOON inside the warning window, otherwise ACTIVE. Perpetual (no
 * expiry) licenses are always ACTIVE.
 */
describe('usage-right effective status derivation', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const inDays = (n: number) => new Date(now.getTime() + n * 864e5);

  it('rounds days-until-expiry up and reports null for a perpetual license', () => {
    expect(daysUntilExpiry(inDays(7), now)).toBe(7);
    expect(daysUntilExpiry(null, now)).toBeNull();
    expect(daysUntilExpiry(inDays(-1), now)).toBeLessThan(0);
  });

  it('is ACTIVE far from expiry and for a perpetual license', () => {
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(120), now)).toBe('ACTIVE');
    expect(computeUsageRightEffectiveStatus('ACTIVE', null, now)).toBe('ACTIVE');
  });

  it('is EXPIRING_SOON inside the warning window (default 14 days)', () => {
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(14), now)).toBe('EXPIRING_SOON');
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(1), now)).toBe('EXPIRING_SOON');
    expect(isUsageRightExpiringSoon('ACTIVE', inDays(3), now)).toBe(true);
    // Just outside the window is still ACTIVE.
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(15), now)).toBe('ACTIVE');
    expect(isUsageRightExpiringSoon('ACTIVE', inDays(15), now)).toBe(false);
  });

  it('is EXPIRED once past expiry even while stored status is still ACTIVE', () => {
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(-1), now)).toBe('EXPIRED');
    expect(isUsageRightExpiringSoon('ACTIVE', inDays(-1), now)).toBe(false);
  });

  it('honours the authoritative stored REVOKED/EXPIRED status regardless of dates', () => {
    expect(computeUsageRightEffectiveStatus('REVOKED', inDays(120), now)).toBe('REVOKED');
    expect(computeUsageRightEffectiveStatus('EXPIRED', inDays(120), now)).toBe('EXPIRED');
    expect(isUsageRightExpiringSoon('REVOKED', inDays(3), now)).toBe(false);
  });

  it('respects a custom warning window', () => {
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(20), now, 30)).toBe('EXPIRING_SOON');
    expect(computeUsageRightEffectiveStatus('ACTIVE', inDays(20), now, 14)).toBe('ACTIVE');
  });
});
