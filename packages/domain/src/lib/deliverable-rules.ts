import type { Prisma } from '@influenceos/database';
import {
  APPROVAL_COMPLETES_TYPES,
  CLOSED_DELIVERABLE_STATUSES,
  DELIVERED_DELIVERABLE_STATUSES,
  addBusinessDays,
  businessToday,
  startOfBusinessDay,
} from '@influenceos/shared';

/**
 * Database filters for the shared deliverable rules
 * (`@influenceos/shared` deliverable-rules): the same meaning of
 * "delivered", "outstanding" and "overdue" for every query. Each returns a
 * self-contained condition — combine them with `AND: [...]`, never spread
 * them into a where that has its own OR/NOT.
 */

/** Posted, or (UGC) approved. */
export const deliveredWhere: Prisma.DeliverableWhereInput = {
  OR: [
    { status: { in: [...DELIVERED_DELIVERABLE_STATUSES] } },
    { status: 'APPROVED', type: { in: [...APPROVAL_COMPLETES_TYPES] } },
  ],
};

/** Still owed: not delivered, not cancelled or missed. */
export const outstandingWhere: Prisma.DeliverableWhereInput = {
  AND: [
    { status: { notIn: [...DELIVERED_DELIVERABLE_STATUSES, ...CLOSED_DELIVERABLE_STATUSES] } },
    { NOT: { status: 'APPROVED', type: { in: [...APPROVAL_COMPLETES_TYPES] } } },
  ],
};

/** Part of the plan (the completion denominator): everything but cancelled work. */
export const countedWhere: Prisma.DeliverableWhereInput = { status: { not: 'CANCELLED' } };

/** Outstanding work whose due day has fully passed in Kuwait. */
export function overdueWhere(now: Date = new Date()): Prisma.DeliverableWhereInput {
  return { AND: [outstandingWhere, { dueDate: { lt: businessToday(now).start } }] };
}

/**
 * Outstanding work due from today through `days` days after today (Kuwait
 * calendar days, inclusive): 0 = due today, 2 = today, tomorrow and the day
 * after.
 */
export function dueWithinWhere(days: number, now: Date = new Date()): Prisma.DeliverableWhereInput {
  const today = businessToday(now);
  return {
    AND: [
      outstandingWhere,
      { dueDate: { gte: today.start, lt: startOfBusinessDay(addBusinessDays(today.key, days + 1)) } },
    ],
  };
}
