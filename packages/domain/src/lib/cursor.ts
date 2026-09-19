import type { CursorPage } from '@influenceos/contracts';

/**
 * Turn a `limit + 1` fetch of already-mapped rows into a {@link CursorPage}
 * (W7-2). Fetch one extra row to know whether a next page exists; the cursor is
 * the last returned row's id. Ordering must include `id` as a stable tiebreaker
 * (e.g. `[{ createdAt: 'desc' }, { id: 'desc' }]`) so paging never skips or
 * repeats a row when two rows share a sort key.
 */
export function buildCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
  return { data, nextCursor, hasMore };
}
