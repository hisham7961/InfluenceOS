import { describe, expect, it } from 'vitest';
import { checkCreator, countriesToCheck, licenceState, licenceStatus } from '../licences';

const DAY = 864e5;
const now = new Date('2026-10-01T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * DAY);

describe('creator licences (P3.5)', () => {
  it("checks only the campaign's countries that need a licence, once each", () => {
    expect(countriesToCheck(['KW', 'SA', 'EG', 'KW'], ['KW', 'SA', 'AE'])).toEqual(['KW', 'SA']);
    expect(countriesToCheck([], ['KW'])).toEqual([]);
    expect(countriesToCheck(['EG'], ['KW'])).toEqual([]);
  });

  it('missing, expired, ends during the campaign, or valid', () => {
    const end = inDays(40);
    expect(licenceState(undefined, end, now)).toBe('MISSING');
    expect(licenceState({ expiresAt: inDays(-1) }, end, now)).toBe('EXPIRED');
    expect(licenceState({ expiresAt: now }, end, now)).toBe('EXPIRED');
    expect(licenceState({ expiresAt: inDays(20) }, end, now)).toBe('EXPIRES_DURING');
    expect(licenceState({ expiresAt: inDays(60) }, end, now)).toBe('VALID');
    expect(licenceState({ expiresAt: null }, end, now)).toBe('VALID');
  });

  it('without a campaign end date (or one already past), "during" means the next 30 days', () => {
    expect(licenceState({ expiresAt: inDays(20) }, null, now)).toBe('EXPIRES_DURING');
    expect(licenceState({ expiresAt: inDays(45) }, null, now)).toBe('VALID');
    expect(licenceState({ expiresAt: inDays(20) }, inDays(-5), now)).toBe('EXPIRES_DURING');
  });

  it('matches each country to that country’s licence', () => {
    const licences = [
      { id: 'a', countryCode: 'KW', expiresAt: inDays(100) },
      { id: 'b', countryCode: 'SA', expiresAt: inDays(-3) },
    ];
    const res = checkCreator(['KW', 'SA', 'AE'], licences, inDays(30), now);
    expect(res.map((r) => [r.countryCode, r.state, r.licence?.id ?? null])).toEqual([
      ['KW', 'VALID', 'a'],
      ['SA', 'EXPIRED', 'b'],
      ['AE', 'MISSING', null],
    ]);
  });

  it("a licence's own status: valid, expiring within 30 days, expired", () => {
    expect(licenceStatus(null, now)).toEqual({ status: 'VALID', daysLeft: null });
    expect(licenceStatus(inDays(90), now)).toEqual({ status: 'VALID', daysLeft: 90 });
    expect(licenceStatus(inDays(30), now)).toEqual({ status: 'EXPIRING_SOON', daysLeft: 30 });
    expect(licenceStatus(inDays(-2), now).status).toBe('EXPIRED');
  });
});
