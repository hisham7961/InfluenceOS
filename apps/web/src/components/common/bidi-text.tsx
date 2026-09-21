/**
 * Renders user/database content that may contain a mix of Arabic and
 * inherently-LTR data (emails, URLs, tracking numbers, @handles, phone
 * numbers, SKUs) without visual scrambling inside an RTL page (Arabic
 * Localization pass §90-93). Two variants:
 *
 * - `<BidiText>` — general mixed text (e.g. a creator name that may itself
 *   be Arabic, English, or mixed with an @handle). Uses `dir="auto"`, which
 *   lets the browser's bidi algorithm pick the right base direction per the
 *   string's own first strong character, and isolates it from the
 *   surrounding paragraph's direction so it never drags neighboring RTL
 *   punctuation out of place.
 * - `<LtrText>` — content that must ALWAYS read left-to-right regardless of
 *   the surrounding locale (emails, URLs, tracking numbers, phone numbers,
 *   IDs, SKUs) — section 93's explicit list. Forces `dir="ltr"` so
 *   `+965 1234 5678` or `DHL 123456789` never has its digit/punctuation
 *   order reversed inside Arabic UI.
 *
 * Prefer these over manually injecting LRM/RLM marks — see the doc comment
 * on why in docs/localization/README.md's Bidi section.
 */
import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function BidiText({
  children,
  as: As = 'span',
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return (
    <As dir="auto" className={className}>
      {children}
    </As>
  );
}

export function LtrText({
  children,
  as: As = 'span',
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return (
    <As dir="ltr" className={cn('inline-block text-left', className)}>
      {children}
    </As>
  );
}
