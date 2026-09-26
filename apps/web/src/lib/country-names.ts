'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';
import { COUNTRIES, countryName } from '@influenceos/shared';

/** Gulf countries first wherever a country is picked — most campaigns target them. */
export const GULF_COUNTRY_CODES = ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'] as const;

/**
 * A country's name in the viewer's language ("الكويت" / "Kuwait"), from the
 * browser's own region names; the English name when the browser has none.
 */
export function useCountryName(): (code: string | null | undefined) => string {
  const locale = useLocale();
  const names = React.useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);
  return React.useCallback(
    (code) => {
      if (!code) return '';
      try {
        return names?.of(code) ?? countryName(code) ?? code;
      } catch {
        return countryName(code) ?? code;
      }
    },
    [names],
  );
}

/** Every country, named in the viewer's language and sorted by that name. */
export function useSortedCountries(): { code: string; name: string }[] {
  const name = useCountryName();
  const locale = useLocale();
  return React.useMemo(
    () =>
      COUNTRIES.map((c) => ({ code: c.code, name: name(c.code) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale),
      ),
    [name, locale],
  );
}

/** "Kuwait, Saudi Arabia and Qatar" / "الكويت والسعودية وقطر". */
export function useCountryList(): (codes: readonly string[]) => string {
  const name = useCountryName();
  const locale = useLocale();
  return React.useCallback(
    (codes) => {
      const names = codes.map((c) => name(c));
      try {
        return new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
      } catch {
        return names.join(', ');
      }
    },
    [name, locale],
  );
}
