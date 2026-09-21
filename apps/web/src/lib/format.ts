import { format, formatDistanceToNow, isValid, parseISO, type Locale as DateFnsLocale } from 'date-fns';
import { arSA, enUS } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import type { Locale } from '@/i18n/request';

export {
  formatCompact,
  formatNumber,
  formatCurrency,
  formatPercent,
  orNA,
  initials,
  colorFromString,
} from '@influenceos/shared';

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === 'string' ? parseISO(input) : input;
  return isValid(d) ? d : null;
}

/** Resolves the date-fns locale object for an app locale, so every
 * `format()`/`formatDistanceToNow()` call renders weekday/month names and
 * relative-time phrasing in the right language instead of always defaulting
 * to English. This is the single canonical mapping — nothing else in the
 * codebase should redefine it. */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return locale === 'ar' ? arSA : enUS;
}

export function relativeTime(input: string | Date | null | undefined, locale: Locale): string {
  const d = toDate(input);
  return d ? formatDistanceToNow(d, { addSuffix: true, locale: dateFnsLocale(locale) }) : '—';
}

export function shortDate(input: string | Date | null | undefined, locale: Locale): string {
  const d = toDate(input);
  return d ? format(d, 'MMM d, yyyy', { locale: dateFnsLocale(locale) }) : '—';
}

export function dateTime(input: string | Date | null | undefined, locale: Locale): string {
  const d = toDate(input);
  return d ? format(d, 'MMM d, yyyy · HH:mm', { locale: dateFnsLocale(locale) }) : '—';
}

export function dayMonth(input: string | Date | null | undefined, locale: Locale): string {
  const d = toDate(input);
  return d ? format(d, 'MMM d', { locale: dateFnsLocale(locale) }) : '—';
}

/** Client-component convenience hook: resolves the active locale once (via
 * next-intl's `useLocale()`) and returns the date formatters pre-bound to
 * it, so call sites don't need to thread `locale` through by hand. Server
 * Components can't use hooks — they should call `getLocale()` from
 * `next-intl/server` and pass it directly to the plain functions above. */
export function useLocalizedFormat() {
  const locale = useLocale() as Locale;
  return {
    shortDate: (input: string | Date | null | undefined) => shortDate(input, locale),
    dateTime: (input: string | Date | null | undefined) => dateTime(input, locale),
    relativeTime: (input: string | Date | null | undefined) => relativeTime(input, locale),
    dayMonth: (input: string | Date | null | undefined) => dayMonth(input, locale),
  };
}
