import { z } from 'zod';

/**
 * One consistent pagination system (addendum §29). Management tables use
 * offset pagination; large feeds (What's New, Live Content, Notifications,
 * Activity) use cursor pagination.
 */

export interface OffsetPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: OffsetPagination;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const offsetQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export type OffsetQuery = z.infer<typeof offsetQuerySchema>;
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export function buildOffsetPagination(
  page: number,
  pageSize: number,
  total: number,
): OffsetPagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
