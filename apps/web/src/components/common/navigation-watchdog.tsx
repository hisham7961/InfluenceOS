'use client';
import * as React from 'react';

/** How long a link click may take to reach its page before a full load takes over. */
const STALL_MS = 5000;

/**
 * Safety net for Next.js 15.5 in-app navigation. Now and then a link click
 * fetches the next page and then never switches to it — the request is
 * dropped after it arrives and the old page stays (measured: about 1 in 5
 * clicks from Reports to Rate benchmarks). Nothing tells the person anything
 * went wrong; the click just seems to do nothing.
 *
 * This watches clicks that Next.js took over (plain left-clicks on same-site
 * links, default prevented by <Link>). If the address still hasn't changed
 * after a few seconds, it loads the target page the ordinary way. A navigation
 * that works is never touched: it changes the address well before then.
 */
export function NavigationWatchdog() {
  React.useEffect(() => {
    let timer: number | undefined;

    function onClick(e: MouseEvent) {
      // Only what <Link> handled itself: an unmodified primary click it prevented.
      if (!e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;
      // A button inside a link card that does its own thing is not a navigation.
      const control = target?.closest('button, input, select, textarea, [role="button"]');
      if (control && control !== anchor && anchor.contains(control)) return;

      const to = new URL(anchor.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      const from = window.location.pathname + window.location.search;
      if (to.pathname + to.search === from) return; // same page or only a #hash

      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.location.pathname + window.location.search === from) {
          window.location.assign(to.href);
        }
      }, STALL_MS);
    }

    // Bubble phase on window: runs after React (and <Link>) handled the click.
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('click', onClick);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
