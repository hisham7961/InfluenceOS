import { addBusinessDays, businessDateKey, businessDaysBetween, startOfBusinessDay } from './business-day';

/**
 * Reporting periods and trend buckets in Kuwait time (P2.7). A period is a
 * run of whole Kuwait days; it is compared with the one right before it of
 * the same length ("this month so far" against the same days of last month).
 */
export const REPORT_PERIODS = ['month', 'quarter', 'year', 'last30', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const TREND_BUCKETS = ['week', 'month'] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

export interface ResolvedPeriod {
  period: ReportPeriod;
  /** First day (YYYY-MM-DD, Kuwait) and last day, inclusive. */
  fromKey: string;
  toKey: string;
  /** Instants for queries: `{ gte: from, lt: to }`. */
  from: Date;
  to: Date;
  previousFromKey: string;
  previousToKey: string;
  previousFrom: Date;
  previousTo: Date;
  days: number;
}

const parts = (key: string) => key.split('-').map(Number) as [number, number, number];
const keyOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

function range(fromKey: string, toKey: string) {
  return { from: startOfBusinessDay(fromKey), to: startOfBusinessDay(addBusinessDays(toKey, 1)) };
}

/**
 * The days a period covers, and the same number of days before it. For
 * month/quarter/year "so far": the previous one starts at the start of the
 * previous month/quarter/year and never runs into the current one.
 */
export function resolvePeriod(
  period: ReportPeriod,
  now: Date = new Date(),
  custom: { from?: string | null; to?: string | null } = {},
): ResolvedPeriod {
  const today = businessDateKey(now);
  const [y, m] = parts(today);
  let fromKey: string;
  let toKey = today;
  let previousFromKey: string;
  let previousStartCap: string;

  switch (period) {
    case 'month':
      fromKey = keyOf(y, m, 1);
      previousFromKey = keyOf(y, m - 1, 1);
      previousStartCap = fromKey;
      break;
    case 'quarter': {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      fromKey = keyOf(y, qStart, 1);
      previousFromKey = keyOf(y, qStart - 3, 1);
      previousStartCap = fromKey;
      break;
    }
    case 'year':
      fromKey = keyOf(y, 1, 1);
      previousFromKey = keyOf(y - 1, 1, 1);
      previousStartCap = fromKey;
      break;
    case 'custom': {
      const f = custom.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? custom.from : addBusinessDays(today, -29);
      const t = custom.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? custom.to : today;
      fromKey = f <= t ? f : t;
      toKey = f <= t ? t : f;
      const len = businessDaysBetween(fromKey, toKey) + 1;
      previousFromKey = addBusinessDays(fromKey, -len);
      previousStartCap = fromKey;
      break;
    }
    case 'last30':
    default:
      fromKey = addBusinessDays(today, -29);
      previousFromKey = addBusinessDays(fromKey, -30);
      previousStartCap = fromKey;
      break;
  }

  const days = businessDaysBetween(fromKey, toKey) + 1;
  let previousToKey = addBusinessDays(previousFromKey, days - 1);
  if (previousToKey >= previousStartCap) previousToKey = addBusinessDays(previousStartCap, -1);
  const current = range(fromKey, toKey);
  const previous = range(previousFromKey, previousToKey);
  return {
    period,
    fromKey,
    toKey,
    from: current.from,
    to: current.to,
    previousFromKey,
    previousToKey,
    previousFrom: previous.from,
    previousTo: previous.to,
    days,
  };
}

/** The bucket a Kuwait day falls in: its month's first day, or the Sunday that starts its week. */
export function bucketStartKey(dayKey: string, bucket: TrendBucket): string {
  const [y, m, d] = parts(dayKey);
  if (bucket === 'month') return keyOf(y, m, 1);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addBusinessDays(dayKey, -weekday);
}

/** Every bucket start from the one holding `fromKey` to the one holding `toKey`. */
export function bucketStarts(fromKey: string, toKey: string, bucket: TrendBucket): string[] {
  const out: string[] = [];
  let k = bucketStartKey(fromKey, bucket);
  const last = bucketStartKey(toKey, bucket);
  while (k <= last && out.length < 400) {
    out.push(k);
    if (bucket === 'week') k = addBusinessDays(k, 7);
    else {
      const [y, m] = parts(k);
      k = keyOf(y, m + 1, 1);
    }
  }
  return out;
}

/** Change from `previous` to `current` as a rounded %, or null when there's nothing to compare with. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** The median of the numbers given, or null for none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
