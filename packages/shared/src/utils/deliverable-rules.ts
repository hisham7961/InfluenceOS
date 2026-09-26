import { addBusinessDays, businessDateKey, businessDaysBetween, startOfBusinessDay } from './business-day';

/**
 * One set of rules for "delivered", "still owed" and "overdue", used by every
 * screen, report, notification and the worker (they used to disagree: eight
 * different status groups, APPROVED counted as posted in some places and not
 * in others, cancelled work kept completion below 100%).
 *
 * - Delivered: the post is up (PUBLISHED, VERIFIED). UGC is handed over, not
 *   posted, so for UGC an APPROVED asset is delivered too. An approved draft
 *   of any other type is cleared to post — not yet delivered.
 * - Closed: CANCELLED (dropped from the plan) or MISSED (it will not happen).
 * - Outstanding: neither delivered nor closed. Only outstanding work can be
 *   overdue or "due today".
 * - Overdue: outstanding, and its due day has fully passed in Kuwait.
 * - Completion counts every deliverable except cancelled ones; a missed one
 *   stays in the plan and keeps completion below 100%.
 */

type DeliverableLike = { status: string; type?: string | null };

export const DELIVERED_DELIVERABLE_STATUSES = ['PUBLISHED', 'VERIFIED'] as const;
export const CLOSED_DELIVERABLE_STATUSES = ['CANCELLED', 'MISSED'] as const;
/** Deliverable types that complete on approval rather than on posting. */
export const APPROVAL_COMPLETES_TYPES = ['UGC'] as const;

export function isDeliverableDelivered(d: DeliverableLike): boolean {
  if ((DELIVERED_DELIVERABLE_STATUSES as readonly string[]).includes(d.status)) return true;
  return d.status === 'APPROVED' && (APPROVAL_COMPLETES_TYPES as readonly string[]).includes(d.type ?? '');
}

export function isDeliverableOutstanding(d: DeliverableLike): boolean {
  return !isDeliverableDelivered(d) && !(CLOSED_DELIVERABLE_STATUSES as readonly string[]).includes(d.status);
}

/** Counts in the completion denominator (everything but cancelled work). */
export function countsTowardCompletion(d: DeliverableLike): boolean {
  return d.status !== 'CANCELLED';
}

/** The instant after which work due on `dueDate`'s day is overdue: the next Kuwait midnight. */
export function overdueAfter(dueDate: Date | string): Date {
  return startOfBusinessDay(addBusinessDays(businessDateKey(dueDate), 1));
}

export function isDeliverableOverdue(
  d: DeliverableLike & { dueDate: Date | string | null | undefined },
  now: Date = new Date(),
): boolean {
  if (!d.dueDate || !isDeliverableOutstanding(d)) return false;
  return businessDateKey(d.dueDate) < businessDateKey(now);
}

/** Calendar days until the due day (0 = due today, negative = days late). */
export function daysUntilDue(dueDate: Date | string, now: Date = new Date()): number {
  return businessDaysBetween(businessDateKey(now), businessDateKey(dueDate));
}

/** Delivered share of the plan, 0–100 (0 when there is nothing planned). */
export function deliverableCompletion(deliverables: DeliverableLike[]): {
  delivered: number;
  total: number;
  percent: number;
} {
  const counted = deliverables.filter(countsTowardCompletion);
  const delivered = counted.filter(isDeliverableDelivered).length;
  return {
    delivered,
    total: counted.length,
    percent: counted.length > 0 ? Math.round((delivered / counted.length) * 100) : 0,
  };
}
