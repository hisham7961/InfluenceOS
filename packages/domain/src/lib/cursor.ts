import { buildOffsetPagination, type CursorPage } from '@influenceos/contracts';

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

/** How a list was asked to page: by `cursor`, or by a numbered `page`. */
export interface ListWindow {
  cursor?: string;
  page?: number;
  limit: number;
}

/**
 * Prisma skip/take for a {@link ListWindow}: a numbered page skips the rows
 * before it; a cursor page fetches one extra row to learn whether more
 * follow. Pair with {@link windowPage}, and count the matching rows when
 * `page` is set.
 */
export function windowArgs(w: ListWindow): { take: number; skip?: number; cursor?: { id: string } } {
  if (w.page) return { skip: (w.page - 1) * w.limit, take: w.limit };
  return { take: w.limit + 1, ...(w.cursor ? { cursor: { id: w.cursor }, skip: 1 } : {}) };
}

/** Rows fetched with {@link windowArgs} as a CursorPage; a numbered page also carries its total. */
export function windowPage<T extends { id: string }>(rows: T[], w: ListWindow, total: number | null): CursorPage<T> {
  if (w.page) {
    const pagination = buildOffsetPagination(w.page, w.limit, total ?? 0);
    return { data: rows, nextCursor: null, hasMore: w.page < pagination.totalPages, pagination };
  }
  return buildCursorPage(rows, w.limit);
}
