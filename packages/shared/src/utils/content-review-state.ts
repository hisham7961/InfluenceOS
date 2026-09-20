/**
 * Per-user content review state — NEW/SEEN/REVIEWED are DERIVED the same way
 * everywhere (never a stored enum column, never re-derived differently on
 * Web vs a future mobile client). See UserContentState in the Prisma schema
 * and packages/domain/src/services/content.service.ts.
 *
 * Deliberately NOT "WATCHED" — opening a social embed does not mean the video
 * was actually watched to completion; platforms don't reliably expose that.
 */
export type ContentReviewStatus = 'NEW' | 'SEEN' | 'REVIEWED';

export interface ContentViewerState {
  firstSeenAt: string | null;
  lastOpenedAt: string | null;
  reviewedAt: string | null;
  savedForLaterAt: string | null;
}

export function contentReviewStatus(state: ContentViewerState | null | undefined): ContentReviewStatus {
  // reviewedAt wins outright — content.service's updateViewState() always
  // stamps firstSeenAt alongside reviewedAt (you can't review what you
  // haven't opened), but checking reviewedAt first keeps this derivation
  // correct even if that invariant is ever violated upstream.
  if (state?.reviewedAt) return 'REVIEWED';
  if (!state?.firstSeenAt) return 'NEW';
  return 'SEEN';
}

export const CONTENT_REVIEW_STATUS_LABELS: Record<ContentReviewStatus, string> = {
  NEW: 'New',
  SEEN: 'Seen',
  REVIEWED: 'Reviewed',
};
