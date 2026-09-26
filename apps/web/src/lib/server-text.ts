import { createServerTextMatcher, translateServerMessage, type EnumCatalog } from '@influenceos/shared';
import enServerText from '../../messages/en/serverText.json';
import enEnums from '../../messages/en/enums.json';

/**
 * Server-generated text in the viewer's language (P2.5).
 *
 * The API and worker write error messages, notification titles/bodies and
 * activity lines in English. messages/en/serverText.json holds each of them
 * as a template ("{name} added {count} creators."); the Arabic entry with the
 * same key is what the viewer sees. Matching happens here, on the text the
 * API returned, so nothing on the server changes and a message missing from
 * the catalog simply stays English. scripts/server-text.mjs (run in CI with
 * the translation parity check) fails when the server gains a message the
 * catalog doesn't have. The matching engine is shared with the worker's
 * emails (@influenceos/shared server-text).
 */
const matcher = createServerTextMatcher(enServerText as Record<string, string>, enEnums as EnumCatalog);

/** The catalog key and values of a server message, or null when it isn't in the catalog. */
export function matchServerText(text: string): { key: string; params: Record<string, string> } | null {
  return matcher.match(text);
}

type Translate = (key: string, params: Record<string, string>) => string;

/**
 * Translate one server message with a next-intl translator for the
 * `serverText` namespace (and, optionally, one for `enums` to translate
 * English values inside it).
 */
export function translateServerText(text: string, t: Translate, locale: string, tEnum?: (ref: string) => string): string {
  if (!text || locale === 'en') return text;
  return translateServerMessage(matcher, text, t, tEnum);
}
