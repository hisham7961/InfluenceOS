'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Lightweight background refresh for server-rendered views whose data changes
 * from the worker or providers (Mission Control alerts, What's New). When the
 * operator returns to the tab, it re-runs the server render — throttled so
 * flipping between tabs doesn't refetch constantly. No polling, no WebSockets;
 * future mobile clients rely on the same backend endpoints, not this helper.
 */
export function RefreshOnFocus({ minIntervalMs = 20_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  const last = React.useRef(Date.now());

  React.useEffect(() => {
    function maybeRefresh() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last.current < minIntervalMs) return;
      last.current = now;
      router.refresh();
    }
    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [router, minIntervalMs]);

  return null;
}
