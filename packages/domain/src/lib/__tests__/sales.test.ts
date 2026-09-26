import { describe, expect, it } from 'vitest';
import {
  asciiDigits,
  codeCovers,
  detectCurrency,
  isCancelledStatus,
  isLikelyBot,
  linkSlugFrom,
  newLinkSlug,
  normalizeCode,
  parseAmount,
  parseOrders,
  parseSaleDate,
  pickCode,
  withUtm,
} from '../sales';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('sales file cells', () => {
  it('reads Arabic-Indic digits and separators', () => {
    expect(asciiDigits('١٢٫٥٠٠')).toBe('12.500');
    expect(asciiDigits('۱۲۳')).toBe('123');
  });

  it('normalizes codes', () => {
    expect(normalizeCode(' sara 15 ')).toBe('SARA15');
    expect(normalizeCode('#Glow10')).toBe('GLOW10');
    expect(normalizeCode('سارة١٥')).toBe('سارة15');
  });

  it('finds the currency in a money cell', () => {
    expect(detectCurrency('KWD 12.500')).toBe('KWD');
    expect(detectCurrency('12.500 KD')).toBe('KWD');
    expect(detectCurrency('١٢٫٥ د.ك')).toBe('KWD');
    expect(detectCurrency('99 ر.س')).toBe('SAR');
    expect(detectCurrency('$10')).toBe('USD');
    expect(detectCurrency('12.5')).toBeNull();
  });

  it('parses amounts the way Gulf shops write them', () => {
    expect(parseAmount('12.500')).toEqual({ amount: 12.5, currency: null });
    expect(parseAmount('KWD 1,250.750')).toEqual({ amount: 1250.75, currency: 'KWD' });
    expect(parseAmount('12,500')?.amount).toBe(12500);
    expect(parseAmount('1.250,50')?.amount).toBe(1250.5);
    expect(parseAmount('12,5')?.amount).toBe(12.5);
    expect(parseAmount('1.250.000')?.amount).toBe(1250000);
    expect(parseAmount('١٬٢٥٠٫٥ د.ك')).toEqual({ amount: 1250.5, currency: 'KWD' });
    expect(parseAmount('-5.000')?.amount).toBe(-5);
    expect(parseAmount('(5.000)')?.amount).toBe(-5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
  });

  it('counts orders (blank is one)', () => {
    expect(parseOrders('')).toBe(1);
    expect(parseOrders(undefined)).toBe(1);
    expect(parseOrders('٣')).toBe(3);
    expect(parseOrders('0')).toBeNull();
    expect(parseOrders('2.5')).toBeNull();
  });

  it('spots cancelled and refunded orders', () => {
    expect(isCancelledStatus('Refunded')).toBe(true);
    expect(isCancelledStatus('cancelled')).toBe(true);
    expect(isCancelledStatus('ملغي')).toBe(true);
    expect(isCancelledStatus('مسترجع')).toBe(true);
    expect(isCancelledStatus('paid')).toBe(false);
    expect(isCancelledStatus('')).toBe(false);
  });
});

describe('order dates (Kuwait time unless stated)', () => {
  it('reads ISO dates and times', () => {
    expect(iso(parseSaleDate('2026-09-01'))).toBe('2026-08-31T21:00:00.000Z');
    expect(iso(parseSaleDate('2026-09-01 14:33'))).toBe('2026-09-01T11:33:00.000Z');
    expect(iso(parseSaleDate('2026-09-01T10:00:00Z'))).toBe('2026-09-01T10:00:00.000Z');
    expect(iso(parseSaleDate('2026-09-01 14:33:00 +0300'))).toBe('2026-09-01T11:33:00.000Z');
    expect(iso(parseSaleDate('2026-09-01 14:33:00 -04:00'))).toBe('2026-09-01T18:33:00.000Z');
  });

  it('reads day-first dates, and month-first when told or obvious', () => {
    expect(iso(parseSaleDate('01/09/2026'))).toBe('2026-08-31T21:00:00.000Z');
    expect(iso(parseSaleDate('01/09/2026', 'MDY'))).toBe('2026-01-08T21:00:00.000Z');
    expect(iso(parseSaleDate('09/13/2026', 'DMY'))).toBe('2026-09-12T21:00:00.000Z');
    expect(iso(parseSaleDate('13.09.26'))).toBe('2026-09-12T21:00:00.000Z');
    expect(iso(parseSaleDate('١/٩/٢٠٢٦ 2:30 PM'))).toBe('2026-09-01T11:30:00.000Z');
    expect(iso(parseSaleDate('1/9/2026 12:05 ص'))).toBe('2026-08-31T21:05:00.000Z');
  });

  it('reads Excel date numbers and written-out dates', () => {
    expect(iso(parseSaleDate('46266'))).toBe('2026-08-31T21:00:00.000Z');
    expect(iso(parseSaleDate('Sep 1, 2026 10:00 AM'))).toBe('2026-09-01T07:00:00.000Z');
  });

  it('refuses what is not a real date', () => {
    expect(parseSaleDate('31/02/2026')).toBeNull();
    expect(parseSaleDate('yesterday')).toBeNull();
    expect(parseSaleDate('1999-01-01')).toBeNull();
    expect(parseSaleDate('')).toBeNull();
  });
});

describe('matching', () => {
  const known = new Set(['k7x2mpq']);
  it('finds our link in a URL, a UTM tag or on its own', () => {
    expect(linkSlugFrom('https://go.agency.com/r/k7x2mpq', known)).toBe('k7x2mpq');
    expect(linkSlugFrom('/products/glow?utm_source=sara&utm_content=K7X2MPQ', known)).toBe('k7x2mpq');
    expect(linkSlugFrom('k7x2mpq', known)).toBe('k7x2mpq');
    expect(linkSlugFrom('https://go.agency.com/r/other', known)).toBeNull();
    expect(linkSlugFrom('', known)).toBeNull();
  });

  const d = (s: string) => new Date(s);
  const older = { id: 'old', validFrom: d('2026-01-01T00:00:00Z'), validTo: null };
  const newer = { id: 'new', validFrom: d('2026-06-01T00:00:00Z'), validTo: null };
  const ended = { id: 'ended', validFrom: null, validTo: d('2026-03-31T21:00:00Z') }; // 1 Apr Kuwait

  it('covers through the end of the last Kuwait day', () => {
    expect(codeCovers(ended, d('2026-04-01T20:59:00Z'))).toBe(true);
    expect(codeCovers(ended, d('2026-04-01T21:00:00Z'))).toBe(false);
  });

  it('gives a reused code to the campaign that started last', () => {
    expect(pickCode([older, newer], d('2026-03-01T00:00:00Z'))?.id).toBe('old');
    expect(pickCode([older, newer], d('2026-07-01T00:00:00Z'))?.id).toBe('new');
    expect(pickCode([newer], d('2026-03-01T00:00:00Z'))).toBeNull();
    expect(pickCode([ended, older], d('2026-02-01T00:00:00Z'))?.id).toBe('old');
  });
});

describe('tracking links', () => {
  it('makes short slugs without look-alike characters', () => {
    const slug = newLinkSlug();
    expect(slug).toMatch(/^[a-km-np-z2-9]{7}$/);
    expect(newLinkSlug()).not.toBe(slug);
  });

  it('adds UTM tags without overriding the brand’s own', () => {
    const url = withUtm('https://shop.example/glow?utm_source=brand', { source: 'sara', campaign: 'winter', content: 'k7x2mpq' });
    const u = new URL(url);
    expect(u.searchParams.get('utm_source')).toBe('brand');
    expect(u.searchParams.get('utm_medium')).toBe('influencer');
    expect(u.searchParams.get('utm_campaign')).toBe('winter');
    expect(u.searchParams.get('utm_content')).toBe('k7x2mpq');
  });

  it('does not count link previews and scripts', () => {
    expect(isLikelyBot('WhatsApp/2.23.20.0 A')).toBe(true);
    expect(isLikelyBot('facebookexternalhit/1.1')).toBe(true);
    expect(isLikelyBot('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isLikelyBot(null)).toBe(true);
    expect(
      isLikelyBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0.0.0'),
    ).toBe(false);
  });
});
