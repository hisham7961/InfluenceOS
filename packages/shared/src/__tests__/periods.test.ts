import { describe, expect, it } from 'vitest';
import { bucketStartKey, bucketStarts, median, percentChange, resolvePeriod } from '../utils/periods';

// 2026-10-14 10:00 in Kuwait (UTC+3).
const now = new Date('2026-10-14T07:00:00.000Z');

describe('reporting periods (P2.7)', () => {
  it('this month so far vs the same days of last month, in Kuwait days', () => {
    const p = resolvePeriod('month', now);
    expect([p.fromKey, p.toKey, p.days]).toEqual(['2026-10-01', '2026-10-14', 14]);
    expect([p.previousFromKey, p.previousToKey]).toEqual(['2026-09-01', '2026-09-14']);
    expect(p.from.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // 00:00 Kuwait
    expect(p.to.toISOString()).toBe('2026-10-14T21:00:00.000Z');
  });

  it('never lets the previous period run into the current one', () => {
    // 31 March: the previous month (February) is shorter.
    const p = resolvePeriod('month', new Date('2026-03-31T07:00:00.000Z'));
    expect([p.previousFromKey, p.previousToKey]).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('quarter and year cross the year boundary', () => {
    const q = resolvePeriod('quarter', new Date('2026-02-10T07:00:00.000Z'));
    expect([q.fromKey, q.previousFromKey]).toEqual(['2026-01-01', '2025-10-01']);
    const y = resolvePeriod('year', now);
    expect([y.fromKey, y.previousFromKey, y.previousToKey]).toEqual(['2026-01-01', '2025-01-01', '2025-10-14']);
  });

  it('custom: the days given, compared with the same number of days before; swapped dates are fixed', () => {
    const c = resolvePeriod('custom', now, { from: '2026-10-10', to: '2026-10-01' });
    expect([c.fromKey, c.toKey, c.days, c.previousFromKey, c.previousToKey]).toEqual([
      '2026-10-01',
      '2026-10-10',
      10,
      '2026-09-21',
      '2026-09-30',
    ]);
    const l = resolvePeriod('last30', now);
    expect([l.fromKey, l.toKey, l.previousToKey]).toEqual(['2026-09-15', '2026-10-14', '2026-09-14']);
  });

  it('weeks start on Sunday; months on the 1st', () => {
    expect(bucketStartKey('2026-10-14', 'week')).toBe('2026-10-11'); // Wednesday → Sunday
    expect(bucketStartKey('2026-10-11', 'week')).toBe('2026-10-11');
    expect(bucketStartKey('2026-10-14', 'month')).toBe('2026-10-01');
    expect(bucketStarts('2026-08-20', '2026-10-14', 'month')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(bucketStarts('2026-12-20', '2027-01-05', 'month')).toEqual(['2026-12-01', '2027-01-01']);
    expect(bucketStarts('2026-10-01', '2026-10-14', 'week')).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
  });

  it('percent change and median', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 3)).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
