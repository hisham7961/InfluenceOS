import { describe, expect, it } from 'vitest';
import { campaignIsLive, checkGapMs, retryGapMs } from '../check-cadence';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date('2026-10-01T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('check cadence (P3.4)', () => {
  it('checks young posts often and old posts rarely', () => {
    expect(checkGapMs({ postedAt: ago(2 * HOUR), now })).toBe(HOUR);
    expect(checkGapMs({ postedAt: ago(2 * DAY), now })).toBe(3 * HOUR);
    expect(checkGapMs({ postedAt: ago(10 * DAY), now })).toBe(6 * HOUR);
    expect(checkGapMs({ postedAt: ago(20 * DAY), now })).toBe(DAY);
    expect(checkGapMs({ postedAt: ago(60 * DAY), now })).toBe(3 * DAY);
    expect(checkGapMs({ postedAt: ago(200 * DAY), now })).toBe(7 * DAY);
  });

  it('a post dated in the future (clock skew) counts as brand new', () => {
    expect(checkGapMs({ postedAt: new Date(now.getTime() + HOUR), now })).toBe(HOUR);
  });

  it('never waits more than six hours while the campaign runs or its report is being written', () => {
    const active = { status: 'ACTIVE', endDate: null };
    expect(checkGapMs({ postedAt: ago(60 * DAY), campaign: active, now })).toBe(6 * HOUR);
    expect(checkGapMs({ postedAt: ago(2 * HOUR), campaign: active, now })).toBe(HOUR);
    const justEnded = { status: 'COMPLETED', endDate: ago(3 * DAY) };
    expect(checkGapMs({ postedAt: ago(40 * DAY), campaign: justEnded, now })).toBe(6 * HOUR);
    const longEnded = { status: 'COMPLETED', endDate: ago(10 * DAY) };
    expect(checkGapMs({ postedAt: ago(40 * DAY), campaign: longEnded, now })).toBe(3 * DAY);
    expect(campaignIsLive({ status: 'PAUSED', endDate: null }, now)).toBe(false);
    expect(campaignIsLive(null, now)).toBe(false);
  });

  it('backs off after failures, but never past the normal gap', () => {
    expect(retryGapMs({ postedAt: ago(20 * DAY), failures: 0, now })).toBe(HOUR);
    expect(retryGapMs({ postedAt: ago(20 * DAY), failures: 3, now })).toBe(8 * HOUR);
    expect(retryGapMs({ postedAt: ago(20 * DAY), failures: 10, now })).toBe(DAY);
    expect(retryGapMs({ postedAt: ago(2 * HOUR), failures: 4, now })).toBe(HOUR);
  });
});
