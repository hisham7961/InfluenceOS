/**
 * How soon a live post is checked again (P3.4). A post's numbers move fast in
 * its first day and hardly at all after a month, so checks follow its age;
 * while its campaign is running (and for a week after it ends, while the
 * report is being written) it is never left longer than six hours.
 *
 *   age < 1 day     → every hour
 *   1–3 days        → every 3 hours
 *   3–14 days       → every 6 hours
 *   14–30 days      → daily
 *   30–90 days      → every 3 days
 *   older           → weekly
 *
 * A failed check backs off 1h, 2h, 4h… but never waits longer than the
 * normal gap for the post's age.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** [max age, gap] from youngest to oldest. */
const STEPS: readonly (readonly [number, number])[] = [
  [DAY, HOUR],
  [3 * DAY, 3 * HOUR],
  [14 * DAY, 6 * HOUR],
  [30 * DAY, DAY],
  [90 * DAY, 3 * DAY],
];
const OLDEST_GAP = 7 * DAY;
/** The longest gap for a post in a running campaign. */
export const LIVE_CAMPAIGN_MAX_GAP_MS = 6 * HOUR;
/** A campaign counts as running until this long after its end date. */
export const CAMPAIGN_REPORTING_GRACE_MS = 7 * DAY;

export interface CadenceInput {
  /** When the post went up (or, if unknown, when we first saw it). */
  postedAt: Date;
  campaign?: { status: string; endDate: Date | null } | null;
  /** Consecutive failed checks before this one (0 after a success). */
  failures?: number;
  now?: Date;
}

/** True while the campaign is running or its report is still being put together. */
export function campaignIsLive(campaign: CadenceInput['campaign'], now: Date): boolean {
  if (!campaign) return false;
  if (campaign.status === 'ACTIVE') return true;
  if (campaign.status === 'COMPLETED' && campaign.endDate) {
    return now.getTime() - campaign.endDate.getTime() <= CAMPAIGN_REPORTING_GRACE_MS;
  }
  return false;
}

/** Milliseconds until the next check after a successful one. */
export function checkGapMs(input: CadenceInput): number {
  const now = input.now ?? new Date();
  const age = Math.max(0, now.getTime() - input.postedAt.getTime());
  let gap = OLDEST_GAP;
  for (const [maxAge, step] of STEPS) {
    if (age < maxAge) {
      gap = step;
      break;
    }
  }
  if (campaignIsLive(input.campaign, now)) gap = Math.min(gap, LIVE_CAMPAIGN_MAX_GAP_MS);
  return gap;
}

/** Milliseconds until the next try after a failed check. */
export function retryGapMs(input: CadenceInput): number {
  const failures = Math.max(0, input.failures ?? 0);
  return Math.min(2 ** Math.min(failures, 20) * HOUR, checkGapMs(input));
}
