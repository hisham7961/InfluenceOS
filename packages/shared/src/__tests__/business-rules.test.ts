import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  businessDateKey,
  businessDayRange,
  businessDaysBetween,
  businessToday,
  startOfBusinessDay,
} from '../utils/business-day';
import {
  countsTowardCompletion,
  daysUntilDue,
  deliverableCompletion,
  isDeliverableDelivered,
  isDeliverableOutstanding,
  isDeliverableOverdue,
  overdueAfter,
} from '../utils/deliverable-rules';

// A due date entered as "26 Sep" is stored as 00:00 UTC that day (= 03:00 Kuwait).
const due26 = new Date('2026-09-26T00:00:00.000Z');

describe('business days (Kuwait time)', () => {
  it('reads the Kuwait calendar day, not the UTC one', () => {
    expect(businessDateKey(new Date('2026-09-25T20:59:59Z'))).toBe('2026-09-25');
    expect(businessDateKey(new Date('2026-09-25T21:00:00Z'))).toBe('2026-09-26'); // midnight in Kuwait
    expect(businessDateKey(due26)).toBe('2026-09-26');
  });

  it('starts a day at Kuwait midnight (21:00 UTC the evening before)', () => {
    expect(startOfBusinessDay('2026-09-26').toISOString()).toBe('2026-09-25T21:00:00.000Z');
    expect(startOfBusinessDay('2026-01-01').toISOString()).toBe('2025-12-31T21:00:00.000Z');
  });

  it('adds days across month and year ends', () => {
    expect(addBusinessDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addBusinessDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(businessDaysBetween('2026-09-26', '2026-10-01')).toBe(5);
    expect(businessDaysBetween('2026-09-26', '2026-09-24')).toBe(-2);
  });

  it('makes a report range include its whole last day', () => {
    const r = businessDayRange('2026-09-01', '2026-09-30');
    expect(r.start?.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(r.end?.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    // A post at 23:30 Kuwait on the 30th is inside.
    const late = new Date('2026-09-30T20:30:00Z');
    expect(late >= r.start! && late < r.end!).toBe(true);
    // Stored day values (00:00 UTC) read the same.
    expect(businessDayRange(new Date('2026-09-30T00:00:00Z'), null).start?.toISOString()).toBe('2026-09-29T21:00:00.000Z');
  });

  it('gives today with its bounds', () => {
    const t = businessToday(new Date('2026-09-26T22:30:00Z')); // 01:30 on the 27th in Kuwait
    expect(t.key).toBe('2026-09-27');
    expect(t.start.toISOString()).toBe('2026-09-26T21:00:00.000Z');
    expect(t.end.toISOString()).toBe('2026-09-27T21:00:00.000Z');
  });
});

describe('deliverable rules', () => {
  it('counts an approved UGC asset as delivered, an approved post as not yet', () => {
    expect(isDeliverableDelivered({ status: 'APPROVED', type: 'UGC' })).toBe(true);
    expect(isDeliverableDelivered({ status: 'APPROVED', type: 'REEL' })).toBe(false);
    expect(isDeliverableDelivered({ status: 'PUBLISHED', type: 'REEL' })).toBe(true);
    expect(isDeliverableDelivered({ status: 'VERIFIED' })).toBe(true);
  });

  it('treats cancelled and missed work as closed, not outstanding', () => {
    for (const status of ['CANCELLED', 'MISSED', 'PUBLISHED']) {
      expect(isDeliverableOutstanding({ status, type: 'POST' })).toBe(false);
    }
    for (const status of ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED']) {
      expect(isDeliverableOutstanding({ status, type: 'POST' })).toBe(true);
    }
  });

  it('is not overdue until the whole due day has passed in Kuwait', () => {
    const d = { status: 'PLANNED', type: 'POST', dueDate: due26 };
    // 03:00 Kuwait on the due day — the old rule already called this overdue.
    expect(isDeliverableOverdue(d, new Date('2026-09-26T00:00:01Z'))).toBe(false);
    // 23:59 Kuwait on the due day.
    expect(isDeliverableOverdue(d, new Date('2026-09-26T20:59:00Z'))).toBe(false);
    // 00:00 Kuwait the next day.
    expect(isDeliverableOverdue(d, new Date('2026-09-26T21:00:00Z'))).toBe(true);
    expect(overdueAfter(due26).toISOString()).toBe('2026-09-26T21:00:00.000Z');
  });

  it('never marks delivered, cancelled or undated work overdue', () => {
    const late = new Date('2026-10-10T12:00:00Z');
    expect(isDeliverableOverdue({ status: 'PUBLISHED', dueDate: due26 }, late)).toBe(false);
    expect(isDeliverableOverdue({ status: 'CANCELLED', dueDate: due26 }, late)).toBe(false);
    expect(isDeliverableOverdue({ status: 'APPROVED', type: 'UGC', dueDate: due26 }, late)).toBe(false);
    expect(isDeliverableOverdue({ status: 'APPROVED', type: 'STORY', dueDate: due26 }, late)).toBe(true);
    expect(isDeliverableOverdue({ status: 'PLANNED', dueDate: null }, late)).toBe(false);
  });

  it('counts calendar days to the due day', () => {
    expect(daysUntilDue(due26, new Date('2026-09-26T20:00:00Z'))).toBe(0);
    expect(daysUntilDue(due26, new Date('2026-09-25T21:30:00Z'))).toBe(0); // already the 26th in Kuwait
    expect(daysUntilDue(due26, new Date('2026-09-24T09:00:00Z'))).toBe(2);
    expect(daysUntilDue(due26, new Date('2026-09-28T09:00:00Z'))).toBe(-2);
  });

  it('leaves cancelled work out of completion but keeps missed work in', () => {
    expect(countsTowardCompletion({ status: 'CANCELLED' })).toBe(false);
    expect(
      deliverableCompletion([
        { status: 'PUBLISHED', type: 'POST' },
        { status: 'CANCELLED', type: 'POST' },
      ]),
    ).toEqual({ delivered: 1, total: 1, percent: 100 });
    expect(
      deliverableCompletion([
        { status: 'PUBLISHED', type: 'POST' },
        { status: 'MISSED', type: 'POST' },
        { status: 'APPROVED', type: 'UGC' },
        { status: 'APPROVED', type: 'REEL' },
      ]),
    ).toEqual({ delivered: 2, total: 4, percent: 50 });
    expect(deliverableCompletion([])).toEqual({ delivered: 0, total: 0, percent: 0 });
  });
});
