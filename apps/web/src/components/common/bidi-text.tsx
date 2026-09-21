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

/**
 * `block`: render as `display: block` instead of the default `inline-block`.
 * Chromium has a rendering bug where an `inline-block` bidi-isolate that is
 * the sole content of a block inside an `overflow-hidden` RTL ancestor (e.g.
 * a KPI tile Card) gets its leading character clipped — confirmed via live
 * inspection (`KWD 42,850.000` rendered as `WD 42,850.000`) even though the
 * DOM text and computed styles were correct. `display: block` sidesteps the
 * RTL inline-reordering code path that triggers it. Only use this when the
 * value is already the sole content of its own block-level line (never for
 * text embedded inline in a sentence or next to sibling content).
 */
export function LtrText({
  children,
  as: As = 'span',
  className,
  block = false,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  block?: boolean;
}) {
  return (
    <As dir="ltr" className={cn(block ? 'block text-left' : 'inline-block text-left', className)}>
      {children}
    </As>
  );
}
