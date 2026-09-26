import { randomBytes } from 'node:crypto';
import { addBusinessDays, businessDateKey, startOfBusinessDay } from '@influenceos/shared';

/**
 * Reading shop order exports and crediting them to creators (P3.1).
 *
 * Shop exports from the Gulf come in many shapes: Arabic-Indic digits,
 * "12.500 د.ك", day-first dates, Excel date numbers. These helpers turn one
 * cell into a value or `null` (the row is then reported, never guessed).
 */

/** Arabic-Indic / Persian digits and Arabic separators → ASCII. */
export function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

/** What codes are matched on: no spaces, no leading '#', upper-case. */
export function normalizeCode(raw: string): string {
  return asciiDigits(raw).replace(/\s+/g, '').replace(/^#+/, '').toUpperCase();
}

const ISO_CURRENCIES = ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR', 'USD', 'EUR', 'GBP', 'EGP', 'JOD'];
const CURRENCY_ALIASES: [string, string][] = [
  ['د.ك', 'KWD'],
  ['دك', 'KWD'],
  ['دينار كويتي', 'KWD'],
  ['ر.س', 'SAR'],
  ['ريال سعودي', 'SAR'],
  ['د.إ', 'AED'],
  ['درهم', 'AED'],
  ['ر.ق', 'QAR'],
  ['ريال قطري', 'QAR'],
  ['د.ب', 'BHD'],
  ['دينار بحريني', 'BHD'],
  ['ر.ع', 'OMR'],
  ['ريال عماني', 'OMR'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
];

/** A currency named in a cell ("KWD", "KD", "د.ك", "$"), or null. */
export function detectCurrency(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/(?:^|[^A-Za-z])([A-Za-z]{3})(?![A-Za-z])/);
  if (iso && ISO_CURRENCIES.includes(iso[1]!.toUpperCase())) return iso[1]!.toUpperCase();
  if (/(?:^|[^A-Za-z])KD(?![A-Za-z])/i.test(s)) return 'KWD';
  if (/(?:^|[^A-Za-z])SR(?![A-Za-z])/i.test(s)) return 'SAR';
  for (const [alias, code] of CURRENCY_ALIASES) if (s.includes(alias)) return code;
  return null;
}

/**
 * A money cell: "12.500", "KWD 1,250.000", "١٢٫٥ د.ك", "1.250,50". A single
 * comma followed by three digits is a thousands separator ("12,500" = 12500);
 * when both separators appear the last one is the decimal point.
 */
export function parseAmount(raw: string): { amount: number; currency: string | null } | null {
  const s = asciiDigits(raw).trim();
  if (!s) return null;
  const match = s.match(/[-+]?\d[\d.,\s]*/);
  if (!match) return null;
  const negative = match[0].startsWith('-') || /^\(.*\)$/.test(s);
  let n = match[0].replace(/^[-+]/, '').replace(/\s+/g, '').replace(/[.,]+$/, '');
  const lastComma = n.lastIndexOf(',');
  const lastDot = n.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    n = lastComma > lastDot ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (lastComma >= 0) {
    n = /^\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, '') : n.split(',').length === 2 ? n.replace(',', '.') : n.replace(/,/g, '');
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3}){2,}$/.test(n)) {
    n = n.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  const amount = Number(n) * (negative ? -1 : 1);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: detectCurrency(s) };
}

/** Whole number of orders in a row; a blank cell is one order. */
export function parseOrders(raw: string | null | undefined): number | null {
  const s = asciiDigits(raw ?? '').trim();
  if (!s) return 1;
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/** Order status words that mean the sale didn't stand. */
const CANCELLED = /cancel|refund|void|declin|fail|reject|ملغ|مسترجع|مرتجع|مسترد|فشل|مرفوض/i;
export function isCancelledStatus(raw: string | null | undefined): boolean {
  return !!raw && CANCELLED.test(raw);
}

export type DateOrder = 'DMY' | 'MDY';

/** Kuwait wall-clock → instant; null when the date doesn't exist. */
function kuwaitWall(y: number, mo: number, d: number, h = 0, mi = 0, sec = 0): Date | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1) return null; // 31/02
  const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(startOfBusinessDay(key).getTime() + ((h * 60 + mi) * 60 + sec) * 1000);
}

function hour12(h: number, marker: string | undefined): number {
  if (!marker) return h;
  const pm = /^(pm|م)$/i.test(marker);
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

/**
 * An order date: ISO ("2026-09-01", "2026-09-01 14:33:00 +0300"), day/month
 * or month/day ("01/09/2026 2:30 PM" — `order` settles 01/09 when neither
 * part is over 12), or an Excel date number. Without a time zone the time is
 * Kuwait time.
 */
export function parseSaleDate(raw: string, order: DateOrder = 'DMY'): Date | null {
  const s = asciiDigits(raw).trim();
  if (!s) return null;

  // Excel serial day number (days since 1899-12-30), wall-clock.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 36526 || n > 73051) return null; // 2000 … 2100
    const ms = Math.round((n - 25569) * 86_400_000);
    const wall = new Date(ms);
    return kuwaitWall(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds());
  }

  const iso = s.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  if (iso) {
    const [, y, mo, d, h, mi, sec, zone] = iso;
    if (zone) {
      const base = kuwaitWall(Number(y), Number(mo), Number(d));
      if (!base) return null;
      const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0));
      if (zone.toUpperCase() === 'Z') return new Date(utc);
      const sign = zone.startsWith('-') ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      const offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
      return new Date(utc - offset * 60_000);
    }
    return kuwaitWall(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0));
  }

  const dm = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?)?$/i);
  if (dm) {
    const [, a, b, yRaw, h, mi, sec, marker] = dm;
    const first = Number(a);
    const second = Number(b);
    const dayFirst = first > 12 ? true : second > 12 ? false : order === 'DMY';
    const y = yRaw!.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    const hh = hour12(Number(h ?? 0), marker);
    return dayFirst
      ? kuwaitWall(y, second, first, hh, Number(mi ?? 0), Number(sec ?? 0))
      : kuwaitWall(y, first, second, hh, Number(mi ?? 0), Number(sec ?? 0));
  }

  // "Sep 1, 2026 10:00 AM" and the like.
  if (!/[A-Za-z]{3}/.test(s)) return null;
  const hasZone = /(Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(s);
  const t = Date.parse(hasZone ? s : `${s} UTC`);
  if (Number.isNaN(t)) return null;
  if (hasZone) return new Date(t);
  const wall = new Date(t);
  return kuwaitWall(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds());
}

/** The tracking-link slug a cell points at (a /r/ link, utm_content, or the slug itself), if it is one of ours. */
export function linkSlugFrom(raw: string | null | undefined, known: ReadonlySet<string>): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const candidates = [
    s.match(/\/r\/([A-Za-z0-9]+)/)?.[1],
    s.match(/[?&]utm_content=([A-Za-z0-9]+)/)?.[1],
    s,
  ];
  for (const c of candidates) {
    if (c && known.has(c.toLowerCase())) return c.toLowerCase();
  }
  return null;
}

export interface CodeWindow {
  validFrom: Date | null;
  validTo: Date | null;
}

/** Does the code's window cover `at`? `validTo` counts through the end of its Kuwait day. */
export function codeCovers(code: CodeWindow, at: Date): boolean {
  if (code.validFrom && at < code.validFrom) return false;
  if (code.validTo && at >= startOfBusinessDay(addBusinessDays(businessDateKey(code.validTo), 1))) return false;
  return true;
}

/**
 * The code a sale on `at` belongs to, among codes with the same text: the
 * ones whose dates cover it, and of those the one that started last (a code
 * reused on a newer campaign takes over from its start date). On a tie the
 * later one in the list wins — pass them oldest first.
 */
export function pickCode<T extends CodeWindow>(codes: T[], at: Date): T | null {
  let best: T | null = null;
  for (const c of codes) {
    if (!codeCovers(c, at)) continue;
    if (!best || (c.validFrom?.getTime() ?? -Infinity) >= (best.validFrom?.getTime() ?? -Infinity)) best = c;
  }
  return best;
}

// Link slugs: no look-alike characters (0/o, 1/l).
const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function newLinkSlug(length = 7): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  return out;
}

/**
 * The destination with UTM tags, so the shop's analytics can tell which
 * creator and campaign sent the visitor. Tags already in the link are kept.
 */
export function withUtm(url: string, tags: { source: string; campaign: string; content: string }): string {
  const u = new URL(url);
  const set = (k: string, v: string) => {
    if (!u.searchParams.has(k) && v) u.searchParams.set(k, v);
  };
  set('utm_source', tags.source);
  set('utm_medium', 'influencer');
  set('utm_campaign', tags.campaign);
  set('utm_content', tags.content);
  return u.toString();
}

/** Link-preview fetchers and scripts: they follow the link but aren't people. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|whatsapp|telegram|slack|discord|skype|embedly|vkshare|pinterest|linkedin|curl|wget|python|java\/|go-http|okhttp|headless|lighthouse|monitor/i;
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_UA.test(userAgent);
}
