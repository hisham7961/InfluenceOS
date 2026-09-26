'use client';

import * as React from 'react';

/**
 * A text input mirrored from a URL parameter. It follows the URL when the
 * value changes elsewhere (Back, Reset, a link, another filter), but never
 * overwrites what the user has typed since: a slow search result landing
 * while the next search is being typed used to replace the new text with the
 * old one.
 */
export function useUrlSyncedInput(urlValue: string | undefined) {
  const [input, setInput] = React.useState(urlValue ?? '');
  const synced = React.useRef(urlValue ?? '');
  React.useEffect(() => {
    const next = urlValue ?? '';
    setInput((current) => (current.trim() === synced.current.trim() ? next : current));
    synced.current = next;
  }, [urlValue]);
  return [input, setInput] as const;
}
