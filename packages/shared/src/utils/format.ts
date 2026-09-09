/** Browser-safe formatting helpers. */

/** Compact number formatting: 17840 → "17.8K", 2500000 → "2.5M". */
export function formatCompact(value: number | null | undefined, locale = 'en'): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatNumber(value: number | null | undefined, locale = 'en'): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat(locale).format(value);
}

export function formatCurrency(
  value: number | null | undefined,
  currency = 'KWD',
  locale = 'en',
): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'KWD' || currency === 'BHD' ? 3 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString(locale)} ${currency}`;
  }
}

export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
  locale = 'en',
): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits }).format(value)}%`;
}

/** Value or a clear "N/A" placeholder — never a fabricated zero. */
export function orNA(value: string | number | null | undefined): string {
  if (value == null || value === '') return 'N/A';
  return String(value);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Deterministic pleasant color from a string (for avatar/cover fallbacks). */
export function colorFromString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 62%, 52%)`;
}
