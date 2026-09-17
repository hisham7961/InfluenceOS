import { Prisma } from '@influenceos/database';

/**
 * Money arithmetic. Every monetary value is stored as `Decimal(18,3)` and is
 * only ever added/subtracted/divided as a {@link Prisma.Decimal} — never as a
 * JavaScript floating-point number, where `0.1 + 0.2 !== 0.3`.
 *
 * Representation contract: DTOs still expose money as a JSON `number`, but that
 * number is produced by a SINGLE Decimal→number conversion at the very end,
 * after all arithmetic is done exactly, and rounded to {@link MONEY_SCALE}. A
 * value at scale 3 maps to the nearest IEEE-754 double, which serializes back to
 * exactly that decimal for every client (web today, native mobile later), so the
 * value is deterministic. Currency is always carried alongside the amount; no FX
 * conversion is ever performed here.
 *
 * Nullability contract: a MISSING amount stays `null` — it is never silently
 * coerced to zero. A FREE collaboration is an explicit exact `0`, distinct from
 * missing.
 */

/** Canonical money scale. KWD/BHD/OMR use 3 decimal places (fils); 2-decimal
 *  currencies simply carry a trailing zero. */
export const MONEY_SCALE = 3;

const ZERO = new Prisma.Decimal(0);

export type MoneyInput = Prisma.Decimal | number | string | null | undefined;

/** Coerce any money-ish input to an exact Decimal rounded to the money scale.
 *  `null`/`undefined` → `null` (missing is preserved, never turned into 0). */
export function toDecimal(value: MoneyInput): Prisma.Decimal | null {
  if (value == null) return null;
  const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return d.toDecimalPlaces(MONEY_SCALE);
}

/** Exact Decimal sum. Missing values are skipped; an all-missing/empty list
 *  sums to an exact `0` (a total with nothing to add is defined as zero).
 *  NOTE: this assumes the caller has already guaranteed a single currency —
 *  it does not look at currency. To sum values that MAY span currencies, use
 *  {@link sumMoneyByCurrency}, which never collapses different currencies. */
export function sumMoney(values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => {
    const d = toDecimal(v);
    return d ? acc.plus(d) : acc;
  }, ZERO);
}

/** An amount paired with the currency it is denominated in. */
export interface CurrencyAmount {
  amount: MoneyInput;
  currency: string | null | undefined;
}

/**
 * Sum amounts grouped by currency — it NEVER adds two different currencies into
 * one figure (finance/DB-03: `sumMoney` used to silently sum KWD + USD as one
 * KWD number). Returns a map of `currency → exact money number`. A missing
 * currency is grouped under `fallback` (default 'KWD') rather than merged with
 * an explicit currency, so legacy null-currency rows never distort a real one.
 */
export function sumMoneyByCurrency(
  entries: CurrencyAmount[],
  fallback = 'KWD',
): Record<string, number> {
  const totals = new Map<string, Prisma.Decimal>();
  for (const e of entries) {
    const d = toDecimal(e.amount);
    if (!d) continue;
    const ccy = (typeof e.currency === 'string' && e.currency.trim()) || fallback;
    totals.set(ccy, (totals.get(ccy) ?? new Prisma.Decimal(0)).plus(d));
  }
  const out: Record<string, number> = {};
  for (const [ccy, d] of totals) out[ccy] = d.toNumber();
  return out;
}

/** Distinct non-empty currencies in a list → a single label + a `mixed` flag.
 *  `mixed` is true when more than one distinct currency is present, in which
 *  case a single-currency grand total would be a lie and must be suppressed. */
export function resolveScopeCurrency(
  currencies: (string | null | undefined)[],
  fallback = 'KWD',
): { currency: string; mixed: boolean } {
  const set = new Set<string>();
  for (const c of currencies) {
    if (typeof c === 'string' && c.trim()) set.add(c.trim());
  }
  if (set.size === 0) return { currency: fallback, mixed: false };
  if (set.size === 1) return { currency: [...set][0]!, mixed: false };
  return { currency: 'MIXED', mixed: true };
}

/** Decimal|number|string|null → `number | null`, rounded to the money scale.
 *  The single boundary conversion used when building a DTO. */
export function toMoneyNumber(value: MoneyInput): number | null {
  const d = toDecimal(value);
  return d ? d.toNumber() : null;
}

/** Like {@link toMoneyNumber} but a missing value becomes `0`. Use only for
 *  aggregate totals that are defined to be zero when empty — never for a
 *  nullable stored field where missing must stay `null`. */
export function moneyNumberOr0(value: MoneyInput): number {
  return toMoneyNumber(value) ?? 0;
}

/** `a - b` as an exact money `number`. Returns `null` when `a` is missing (a
 *  variance against an unknown budget is unknown, not `-spend`). */
export function subtractMoney(a: MoneyInput, b: MoneyInput): number | null {
  const da = toDecimal(a);
  if (da == null) return null;
  return da.minus(toDecimal(b) ?? ZERO).toNumber();
}

/** Integer percentage `round(a / b * 100)`, computed exactly. `null` when the
 *  denominator is missing or ≤ 0. */
export function percentOf(a: MoneyInput, b: MoneyInput): number | null {
  const db = toDecimal(b);
  if (db == null || db.lte(0)) return null;
  const da = toDecimal(a) ?? ZERO;
  return Math.round(da.dividedBy(db).times(100).toNumber());
}
