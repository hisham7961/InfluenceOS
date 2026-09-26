import { formatCurrency } from '@/lib/format';

/**
 * A fee in its currency, written the way money is written everywhere else in
 * the app (Latin digits, currency code; shown left-to-right). Whole units for
 * larger amounts: a benchmark is a guide, not a ledger.
 */
export function formatBenchmarkMoney(value: number, currency: string): string {
  if (Math.abs(value) >= 100) {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${currency} ${Math.round(value)}`;
    }
  }
  return formatCurrency(value, currency);
}

/** Cost per view: small numbers, so up to four decimals. */
export function formatBenchmarkRate(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 3,
      maximumFractionDigits: 4,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(4)}`;
  }
}
