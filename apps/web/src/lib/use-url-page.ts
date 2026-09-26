'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Replace some query-string values without adding a history entry or
 * scrolling. `null`/empty removes a key.
 */
export function useReplaceQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return React.useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      if (qs === (params?.toString() ?? '')) return;
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params],
  );
}

/**
 * The current page number of a list, kept in the address (`?page=3`) so a
 * reload, a shared link or the back button returns to the same page.
 */
export function useUrlPage(key = 'page'): [number, (page: number) => void] {
  const params = useSearchParams();
  const replace = useReplaceQuery();
  const raw = Number(params?.get(key));
  const page = Number.isInteger(raw) && raw > 1 ? raw : 1;
  const setPage = React.useCallback((next: number) => replace({ [key]: next > 1 ? String(next) : null }), [replace, key]);
  return [page, setPage];
}
