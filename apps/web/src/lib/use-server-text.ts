'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { translateServerText } from './server-text';

/** `st(text)` shows a server-generated message (error, notification, activity line) in the viewer's language. */
export function useServerText(): (text: string | null | undefined) => string {
  const t = useTranslations('serverText');
  const tEnums = useTranslations('enums');
  const locale = useLocale();
  return React.useCallback(
    (text: string | null | undefined) =>
      text ? translateServerText(text, (k, p) => t(k, p), locale, (ref) => tEnums(ref)) : '',
    [t, tEnums, locale],
  );
}
