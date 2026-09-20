import { describe, expect, it } from 'vitest';
import { contentReviewStatus } from '../utils/content-review-state';

/**
 * Content Command Center pass — NEW/SEEN/REVIEWED derivation. No row (or a
 * row with firstSeenAt still null) means NEW; a reviewedAt timestamp always
 * wins over a mere open. Never "WATCHED" — see the module doc comment.
 */
describe('contentReviewStatus', () => {
  it('is NEW when there is no viewer state at all', () => {
    expect(contentReviewStatus(null)).toBe('NEW');
    expect(contentReviewStatus(undefined)).toBe('NEW');
  });

  it('is NEW when a row exists but firstSeenAt was never set', () => {
    expect(contentReviewStatus({ firstSeenAt: null, lastOpenedAt: null, reviewedAt: null, savedForLaterAt: null })).toBe('NEW');
  });

  it('is SEEN once opened but not yet reviewed', () => {
    expect(
      contentReviewStatus({ firstSeenAt: '2026-09-20T10:00:00Z', lastOpenedAt: '2026-09-20T10:00:00Z', reviewedAt: null, savedForLaterAt: null }),
    ).toBe('SEEN');
  });

  it('is REVIEWED once explicitly marked, regardless of savedForLaterAt', () => {
    expect(
      contentReviewStatus({
        firstSeenAt: '2026-09-20T10:00:00Z',
        lastOpenedAt: '2026-09-20T10:05:00Z',
        reviewedAt: '2026-09-20T10:05:00Z',
        savedForLaterAt: '2026-09-20T09:00:00Z',
      }),
    ).toBe('REVIEWED');
  });
});
