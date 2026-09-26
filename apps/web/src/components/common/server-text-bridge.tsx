'use client';

import * as React from 'react';
import { setServerTextTranslator } from '@/lib/errors';
import { useServerText } from '@/lib/use-server-text';

/**
 * Registers the viewer's server-text translator for errorMessage() and
 * serverText(), which run outside components (mutation handlers). Set during
 * render so it is ready before any request can fail.
 */
export function ServerTextBridge() {
  const st = useServerText();
  setServerTextTranslator(st);
  return null;
}
