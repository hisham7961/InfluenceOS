'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { setServerTextTranslator, setUploadErrorText } from '@/lib/errors';
import { useServerText } from '@/lib/use-server-text';

/**
 * Registers the viewer's server-text translator — and the sentences for a
 * failed upload — for errorMessage() and serverText(), which run outside
 * components (mutation handlers). Set during render so it is ready before
 * any request can fail.
 */
export function ServerTextBridge() {
  const st = useServerText();
  const t = useTranslations('common');
  setServerTextTranslator(st);
  setUploadErrorText((reason) => t(`uploadError.${reason}`));
  return null;
}
