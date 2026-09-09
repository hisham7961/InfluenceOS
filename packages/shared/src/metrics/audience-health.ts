import type { AudienceHealthLabel } from '../constants/enums';

/**
 * Basic Audience Health Signals (spec §11).
 *
 * This is deliberately NOT fake-follower detection. We never claim a percentage
 * of fake followers. We surface transparent, explainable signals derived from
 * the data we actually hold, and always say WHY a signal is shown. A future
 * `AudienceVerificationProvider` can augment this without schema changes.
 */

export type SignalSeverity = 'positive' | 'neutral' | 'warning';

export interface AudienceSignal {
  key: string;
  severity: SignalSeverity;
  message: string;
}

export interface AudienceHealthResult {
  label: AudienceHealthLabel;
  signals: AudienceSignal[];
  /** How much data backed the assessment (drives LIMITED_DATA). */
  dataPoints: number;
}

export interface FollowerPoint {
  followers: number;
  capturedAt: string | Date;
}

export interface AudienceHealthInput {
  /** Chronological follower snapshots (oldest → newest). */
  followerHistory?: FollowerPoint[];
  /** Latest engagement rate as a percentage, if known. */
  engagementRate?: number | null;
  /** Latest average views on recent content, if known. */
  avgViews?: number | null;
  /** Current follower count, if known. */
  followers?: number | null;
}

const MIN_HISTORY = 3;

export function assessAudienceHealth(input: AudienceHealthInput): AudienceHealthResult {
  const signals: AudienceSignal[] = [];
  const history = (input.followerHistory ?? [])
    .slice()
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  let dataPoints = history.length;
  if (input.engagementRate != null) dataPoints += 1;
  if (input.avgViews != null) dataPoints += 1;

  // --- Engagement rate signal --------------------------------------------
  if (input.engagementRate != null) {
    if (input.engagementRate >= 1.5) {
      signals.push({
        key: 'engagement_healthy',
        severity: 'positive',
        message: `Engagement rate of ${input.engagementRate.toFixed(1)}% is within a healthy range for its size.`,
      });
    } else if (input.engagementRate < 0.3) {
      signals.push({
        key: 'engagement_low',
        severity: 'warning',
        message: `Engagement rate of ${input.engagementRate.toFixed(2)}% is unusually low relative to follower count, which can indicate a disengaged or low-quality audience.`,
      });
    } else {
      signals.push({
        key: 'engagement_ok',
        severity: 'neutral',
        message: `Engagement rate of ${input.engagementRate.toFixed(1)}% is on the lower side but not abnormal.`,
      });
    }
  }

  // --- Growth-trend & spike signals --------------------------------------
  if (history.length >= 2) {
    const first = history[0]!.followers;
    const last = history[history.length - 1]!.followers;
    if (first > 0) {
      const overallPct = ((last - first) / first) * 100;
      if (overallPct > 0) {
        signals.push({
          key: 'growth_positive',
          severity: 'positive',
          message: `Followers grew ${overallPct.toFixed(1)}% across the tracked period.`,
        });
      } else if (overallPct < -5) {
        signals.push({
          key: 'growth_negative',
          severity: 'warning',
          message: `Followers declined ${Math.abs(overallPct).toFixed(1)}% across the tracked period.`,
        });
      }
    }

    // Sudden abnormal jump between consecutive snapshots.
    let maxJump = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]!.followers;
      const cur = history[i]!.followers;
      if (prev > 500) {
        const jump = ((cur - prev) / prev) * 100;
        if (jump > maxJump) maxJump = jump;
      }
    }
    if (maxJump > 40) {
      signals.push({
        key: 'growth_spike',
        severity: 'warning',
        message: `A sudden +${maxJump.toFixed(0)}% follower jump was detected between two snapshots — worth a manual look to confirm it was organic.`,
      });
    }

    // Instability: highly volatile snapshot-to-snapshot changes.
    if (history.length >= MIN_HISTORY) {
      const deltas: number[] = [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1]!.followers;
        const cur = history[i]!.followers;
        if (prev > 0) deltas.push(((cur - prev) / prev) * 100);
      }
      const volatile = deltas.filter((d) => Math.abs(d) > 20).length;
      if (volatile >= 2) {
        signals.push({
          key: 'growth_unstable',
          severity: 'warning',
          message: 'Follower count is unusually unstable across snapshots.',
        });
      }
    }
  }

  // --- View-to-follower ratio --------------------------------------------
  if (input.avgViews != null && input.followers != null && input.followers > 0) {
    const ratio = input.avgViews / input.followers;
    if (ratio > 5) {
      signals.push({
        key: 'views_high_ratio',
        severity: 'neutral',
        message: `Average views are ${ratio.toFixed(1)}× the follower count — strong reach, common for short-form video.`,
      });
    } else if (ratio < 0.02) {
      signals.push({
        key: 'views_low_ratio',
        severity: 'warning',
        message: 'Average views are a very small fraction of the follower count, an unusual view-to-follower ratio.',
      });
    }
  }

  // --- Label --------------------------------------------------------------
  let label: AudienceHealthLabel;
  if (dataPoints < 2) {
    label = 'LIMITED_DATA';
    signals.unshift({
      key: 'limited_data',
      severity: 'neutral',
      message: 'Not enough historical or engagement data yet to assess audience health.',
    });
  } else if (signals.some((s) => s.severity === 'warning')) {
    label = 'REVIEW';
  } else {
    label = 'HEALTHY';
  }

  return { label, signals, dataPoints };
}
