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
 * catalog doesn't have.
 */

interface Compiled {
  key: string;
  re: RegExp;
  names: string[];
  fixed: number;
}

let compiled: Compiled[] | null = null;

function compile(): Compiled[] {
  if (compiled) return compiled;
  compiled = Object.entries(enServerText as Record<string, string>).map(([key, template]) => {
    const names: string[] = [];
    let fixed = 0;
    const pattern = template
      .split(/(\{[^}]+\})/)
      .map((part) => {
        const m = /^\{([^}]+)\}$/.exec(part);
        if (m) {
          names.push(m[1]!);
          return '(.+?)';
        }
        fixed += part.length;
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { key, re: new RegExp(`^${pattern}$`, 's'), names, fixed };
  });
  // The most specific template wins: "Campaign not found." before "{what} not found."
  compiled.sort((a, b) => b.fixed - a.fixed);
  return compiled;
}

/** The catalog key and values of a server message, or null when it isn't in the catalog. */
export function matchServerText(text: string): { key: string; params: Record<string, string> } | null {
  const trimmed = text.trim();
  for (const c of compile()) {
    const m = c.re.exec(trimmed);
    if (!m) continue;
    const params: Record<string, string> = {};
    c.names.forEach((name, i) => {
      params[name] = m[i + 1] ?? '';
    });
    return { key: c.key, params };
  }
  return null;
}

/**
 * Values the server writes into a message as English words — an expense
 * type ("production"), a status ("approved") — found by their English label
 * (or enum key) in the enums catalog, so they can be shown in Arabic too.
 */
let enumIndex: Map<string, string> | null = null;
function enumRef(value: string): string | null {
  if (!enumIndex) {
    enumIndex = new Map();
    for (const [group, entries] of Object.entries(enEnums as Record<string, Record<string, string>>)) {
      for (const [key, label] of Object.entries(entries)) {
        const ref = `${group}.${key}`;
        for (const form of [label, key.replace(/_/g, ' ')]) {
          const k = form.trim().toLowerCase();
          if (k && !enumIndex.has(k)) enumIndex.set(k, ref);
        }
      }
    }
  }
  return enumIndex.get(value.trim().toLowerCase()) ?? null;
}

/** Placeholders that hold names people typed — never looked up as enum words. */
const PROPER = /name|title|campaign|brand|label|username|email|reference|platform/i;

type Translate = (key: string, params: Record<string, string>) => string;

/**
 * Translate one server message with a next-intl translator for the
 * `serverText` namespace (and, optionally, one for `enums` to translate
 * English values inside it).
 */
export function translateServerText(text: string, t: Translate, locale: string, tEnum?: (ref: string) => string): string {
  if (!text || locale === 'en') return text;
  const match = matchServerText(text);
  if (!match) return text;
  const params = { ...match.params };
  if (tEnum) {
    for (const [name, value] of Object.entries(params)) {
      if (PROPER.test(name)) continue;
      const ref = enumRef(value);
      if (!ref) continue;
      try {
        params[name] = tEnum(ref);
      } catch {
        /* keep the English value */
      }
    }
  }
  // Isolate each inserted value (names, amounts, campaign titles) so a Latin
  // run inside an Arabic sentence keeps its own direction and doesn't pull
  // the punctuation around it out of place.
  for (const name of Object.keys(params)) params[name] = `\u2068${params[name]}\u2069`;
  try {
    return t(match.key, params);
  } catch {
    return text;
  }
}
