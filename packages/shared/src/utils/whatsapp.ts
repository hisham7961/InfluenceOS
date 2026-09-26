/**
 * WhatsApp click-to-chat links (wa.me). Creator numbers are typed every which
 * way — "5000 0000", "+965 5000-0000", "0096550000000" — and wa.me needs the
 * full international number as digits only. A plain 8-digit number is a
 * Kuwaiti local number, so it gets +965.
 */

/** Dialling code for local (8-digit) numbers. */
export const LOCAL_DIAL_CODE = '965';

/** Digits-only international number for wa.me, or null if it can't be a phone number. */
export function whatsappNumber(raw: string | null | undefined, localDialCode = LOCAL_DIAL_CODE): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (!trimmed.startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.length === 8) digits = localDialCode + digits;
  }
  // E.164 allows up to 15 digits; anything under 8 isn't a reachable number.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** A wa.me link, optionally with a prefilled message. */
export function whatsappLink(number: string, text?: string): string {
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
