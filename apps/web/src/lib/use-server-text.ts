'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { translateServerText } from './server-text';
import { useCountryName } from './country-names';

/** `st(text)` shows a server-generated message (error, notification, activity line) in the viewer's language. */
export function useServerText(): (text: string | null | undefined) => string {
  const t = useTranslations('serverText');
  const tEnums = useTranslations('enums');
  const locale = useLocale();
  const country = useCountryName();
  return React.useCallback(
    (text: string | null | undefined) =>
      text
        ? translateServerText(text, (k, p) => t(k, p), locale, (ref) =>
            ref.startsWith('country.') ? country(ref.slice(8)) : tEnums(ref),
          )
        : '',
    [t, tEnums, locale, country],
  );
}
