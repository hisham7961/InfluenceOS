/**
 * Business days, in the agency's own time zone.
 *
 * Every "today", "overdue", "due soon" and report date range is a Kuwait
 * calendar day — never UTC midnight (which is 03:00 in Kuwait, so things used
 * to turn overdue at 3am on their due day) and never the browser's zone.
 *
 * Dates entered as a plain day (a due date, a campaign start/end, a report
 * "from"/"to") are stored as 00:00 UTC of that day. Kuwait is ahead of UTC,
 * so that instant falls on the same calendar day in Kuwait — which is why a
 * single rule, "the Kuwait calendar day an instant falls on", reads both
 * stored day values and real timestamps (a post's publishedAt) correctly.
 */

/** Asia/Kuwait is UTC+3 all year (no daylight saving). */
export const BUSINESS_TIME_ZONE = 'Asia/Kuwait';

const DAY_MS = 86_400_000;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    // en-CA formats as YYYY-MM-DD.
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, f);
  }
  return f;
}

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = clockFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    clockFormatters.set(timeZone, f);
  }
  return f;
}

/** The calendar day ('YYYY-MM-DD') an instant falls on in the business zone. */
export function businessDateKey(at: Date | string | number = new Date(), timeZone = BUSINESS_TIME_ZONE): string {
  return dayFormatter(timeZone).format(new Date(at));
}

/** Offset of `timeZone` from UTC at `at`, in ms (Kuwait: +3h). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    clockFormatter(timeZone)
      .formatToParts(new Date(at))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a business day ('YYYY-MM-DD') starts: 00:00 in Kuwait. */
export function startOfBusinessDay(key: string, timeZone = BUSINESS_TIME_ZONE): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Two passes settle zones with daylight saving; Kuwait needs one.
  let at = utcMidnight - zoneOffsetMs(utcMidnight, timeZone);
  at = utcMidnight - zoneOffsetMs(at, timeZone);
  return new Date(at);
}

/** `key` moved by `days` calendar days. */
export function addBusinessDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both 'YYYY-MM-DD'); negative if `to` is earlier. */
export function businessDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

/**
 * Instant bounds of a run of business days: from the start of `fromDay` up to
 * (not including) the start of the day after `toDay`, so the last day counts
 * in full. For queries: `{ gte: range.start, lt: range.end }`.
 */
export function businessDayRange(
  fromDay: Date | string | null | undefined,
  toDay: Date | string | null | undefined,
): { start?: Date; end?: Date } {
  return {
    start: fromDay != null ? startOfBusinessDay(businessDateKey(fromDay)) : undefined,
    end: toDay != null ? startOfBusinessDay(addBusinessDays(businessDateKey(toDay), 1)) : undefined,
  };
}

/** Today in Kuwait, with the instants it starts and ends at. */
export function businessToday(now: Date = new Date()): { key: string; start: Date; end: Date } {
  const key = businessDateKey(now);
  return { key, start: startOfBusinessDay(key), end: startOfBusinessDay(addBusinessDays(key, 1)) };
}
