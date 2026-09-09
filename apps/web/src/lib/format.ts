import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

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

export function relativeTime(input: string | Date | null | undefined): string {
  const d = toDate(input);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : '—';
}

export function shortDate(input: string | Date | null | undefined): string {
  const d = toDate(input);
  return d ? format(d, 'MMM d, yyyy') : '—';
}

export function dateTime(input: string | Date | null | undefined): string {
  const d = toDate(input);
  return d ? format(d, 'MMM d, yyyy · HH:mm') : '—';
}

export function dayMonth(input: string | Date | null | undefined): string {
  const d = toDate(input);
  return d ? format(d, 'MMM d') : '—';
}
