'use client';

import { useSyncExternalStore } from 'react';

/** Below Tailwind's `sm` breakpoint (640px). */
const PHONE_QUERY = '(max-width: 639px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * True on phone-width screens (P3.6). Lists that switch between a table and
 * cards render only one of them, so the page never carries a hidden copy.
 * The server (and the first client render) assume a wider screen.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
