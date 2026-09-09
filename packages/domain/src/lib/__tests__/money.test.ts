import { describe, expect, it } from 'vitest';
import { Prisma } from '@influenceos/database';
import {
  MONEY_SCALE,
  moneyNumberOr0,
  percentOf,
  subtractMoney,
  sumMoney,
  toDecimal,
  toMoneyNumber,
} from '../money';

/**
 * Money precision (freeze pass item 2). Every value here is one that naive
 * JavaScript floating-point arithmetic gets wrong; the money module must get it
 * exactly right. FREE = exact 0, missing = null (never coerced to 0), and the
 * canonical scale is 3 (KWD fils).
 */
describe('money — exact Decimal arithmetic, never JS float', () => {
  it('the canonical float failure: 0.1 + 0.2 is exactly 0.3', () => {
    // Sanity check that plain JS really is wrong here.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toMoneyNumber(sumMoney([0.1, 0.2]))).toBe(0.3);
  });

  it('sums many line items exactly (multi-line expense total)', () => {
    const tenDimes = Array.from({ length: 10 }, () => 0.1);
    // Naive reduce drifts to 0.9999999999999999; Decimal gives exactly 1.
    expect(tenDimes.reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(toMoneyNumber(sumMoney(tenDimes))).toBe(1);

    // 12.345 + 0.005 + 100.1 + 0.055 + 7.495 = 120.000 exactly.
    expect(toMoneyNumber(sumMoney([12.345, 0.005, 100.1, 0.055, 7.495]))).toBe(120);
  });

  it('a FREE deal is an exact zero (distinct from missing)', () => {
    expect(toMoneyNumber(0)).toBe(0);
    expect(moneyNumberOr0(0)).toBe(0);
    expect(toDecimal(0)?.equals(new Prisma.Decimal(0))).toBe(true);
  });

  it('a MISSING amount stays null and is never coerced to 0', () => {
    expect(toMoneyNumber(null)).toBeNull();
    expect(toMoneyNumber(undefined)).toBeNull();
    expect(toDecimal(null)).toBeNull();
    // An aggregate that is *defined* as 0-when-empty may still choose 0.
    expect(moneyNumberOr0(null)).toBe(0);
    expect(toMoneyNumber(sumMoney([null, undefined]))).toBe(0);
  });

  it('sums skip missing values while keeping present ones exact', () => {
    expect(toMoneyNumber(sumMoney([0.1, null, 0.2, undefined]))).toBe(0.3);
  });

  it('rounds to the money scale (KWD fils = 3 places)', () => {
    expect(MONEY_SCALE).toBe(3);
    expect(toMoneyNumber('12.3456')).toBe(12.346); // unambiguous round up
    expect(toMoneyNumber('12.3453')).toBe(12.345); // unambiguous round down
  });

  it('subtracts budget - spend exactly; a null budget yields a null variance', () => {
    // 0.3 - 0.1 in float is 0.19999999999999998.
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
    expect(subtractMoney(120, 0.1)).toBe(119.9);
    expect(subtractMoney(null, 50)).toBeNull();
  });

  it('computes integer budget-used percent from an exact division', () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(10, null)).toBeNull();
    expect(percentOf(10, 0)).toBeNull();
  });

  it('accepts Prisma.Decimal inputs as they arrive from the database', () => {
    const a = new Prisma.Decimal('0.1');
    const b = new Prisma.Decimal('0.2');
    expect(toMoneyNumber(sumMoney([a, b]))).toBe(0.3);
  });
});
