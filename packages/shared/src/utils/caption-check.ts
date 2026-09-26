/**
 * Caption check (P3.5): does a caption (a draft's or a live post's) carry
 * what the deliverable asks for — its hashtags and mentions, and the ad
 * disclosure paid and gifted work must show (#إعلان / #ad). Shared so the
 * API, the team's app and the creator's own page all judge a caption the
 * same way. Browser-safe.
 */

/** Words that mark a post as an ad, in Arabic and English. */
export const DISCLOSURE_PATTERN =
  /(^|[^\p{L}\p{M}\p{N}_])(#ad|#ads|#advert|#advertisement|#sponsored|#paidpartnership|#إعلان|#اعلان|#إعلان_مدفوع|#اعلان_مدفوع|#مدفوع)(?![\p{L}\p{M}\p{N}_])|paid partnership|إعلان مدفوع|اعلان مدفوع|شراكة مدفوعة/iu;

/** The disclosure the app suggests, in the order it suggests them. */
export const SUGGESTED_DISCLOSURES = ['#إعلان', '#ad'] as const;

export function hasDisclosure(text: string | null | undefined): boolean {
  return !!text && DISCLOSURE_PATTERN.test(text);
}

export interface CaptionRules {
  /** Hashtags the caption must carry, each starting with "#". */
  hashtags: string[];
  /** Accounts the caption must mention, each starting with "@". */
  mentions: string[];
  /** The caption must say it is an ad. */
  disclosureRequired: boolean;
}

export interface CaptionCheck {
  hashtags: { tag: string; present: boolean }[];
  mentions: { handle: string; present: boolean }[];
  disclosure: { required: boolean; present: boolean };
  /** Everything required is there. */
  ok: boolean;
  /** Nothing is required, so there is nothing to show. */
  empty: boolean;
}

/** Arabic has no case; fold Latin case and the common alef/ya/ta-marbuta spellings. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '') // harakat, tatweel
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** "#GlowUp", "glowup" and " #glowup " all mean #glowup; same for "@". */
export function normalizeTag(raw: string, prefix: '#' | '@'): string {
  const body = raw.trim().replace(/^[#@]+/, '');
  return body ? `${prefix}${body}` : '';
}

function tokens(text: string, prefix: '#' | '@'): Set<string> {
  const re = prefix === '#' ? /#[\p{L}\p{M}\p{N}_]+/gu : /@[\p{L}\p{M}\p{N}_.]+/gu;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(fold(m[0].replace(/\.+$/, '')));
  return out;
}

/** The deliverable's own tags plus the approved script's, once each, as shown to people. */
export function mergeCaptionRules(
  deliverable: { requiredHashtags: string[]; requiredMentions: string[] },
  script: { hashtags: string[]; mentions: string[] } | null,
  disclosureRequired: boolean,
): CaptionRules {
  const merge = (lists: string[][], prefix: '#' | '@') => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of lists.flat()) {
      const tag = normalizeTag(raw, prefix);
      if (!tag || seen.has(fold(tag))) continue;
      seen.add(fold(tag));
      out.push(tag);
    }
    return out;
  };
  return {
    hashtags: merge([deliverable.requiredHashtags, script?.hashtags ?? []], '#'),
    mentions: merge([deliverable.requiredMentions, script?.mentions ?? []], '@'),
    disclosureRequired,
  };
}

export function checkCaption(
  caption: string | null | undefined,
  rules: CaptionRules,
): CaptionCheck {
  const text = caption ?? '';
  const tags = tokens(text, '#');
  const handles = tokens(text, '@');
  const hashtags = rules.hashtags.map((tag) => ({
    tag,
    present: tags.has(fold(normalizeTag(tag, '#'))),
  }));
  const mentions = rules.mentions.map((handle) => ({
    handle,
    present: handles.has(fold(normalizeTag(handle, '@'))),
  }));
  const disclosure = { required: rules.disclosureRequired, present: hasDisclosure(text) };
  return {
    hashtags,
    mentions,
    disclosure,
    ok:
      hashtags.every((h) => h.present) &&
      mentions.every((m) => m.present) &&
      (!disclosure.required || disclosure.present),
    empty: !hashtags.length && !mentions.length && !disclosure.required,
  };
}
