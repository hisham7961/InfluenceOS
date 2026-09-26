/**
 * Server-generated text in the reader's language (P2.5, P2.6).
 *
 * The API and worker write error messages, notification titles/bodies and
 * activity lines in English. The web app's serverText catalog holds each one
 * as a template ("{name} added {count} creators."); the Arabic entry with the
 * same key is what an Arabic reader sees. This is the matching engine, shared
 * by the web app (rendering with next-intl) and the worker (emails). The
 * catalogs themselves live in apps/web/messages/<locale>/serverText.json.
 */

export type Catalog = Record<string, string>;
export type EnumCatalog = Record<string, Record<string, string>>;

interface Compiled {
  key: string;
  re: RegExp;
  names: string[];
  fixed: number;
}

/** Placeholders that hold names people typed — never looked up as enum words. */
const PROPER = /name|title|campaign|brand|label|username|email|reference|platform/i;

export interface ServerTextMatcher {
  /** The catalog key and values of a server message, or null when it isn't in the catalog. */
  match(text: string): { key: string; params: Record<string, string> } | null;
  /**
   * The enum reference ("deliverableType.REEL") of an English value the
   * server wrote into a message, or null.
   */
  enumRef(value: string): string | null;
}

export function createServerTextMatcher(englishCatalog: Catalog, englishEnums: EnumCatalog): ServerTextMatcher {
  let compiled: Compiled[] | null = null;
  let enumIndex: Map<string, string> | null = null;

  function compile(): Compiled[] {
    if (compiled) return compiled;
    compiled = Object.entries(englishCatalog).map(([key, template]) => {
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

  return {
    match(text) {
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
    },
    enumRef(value) {
      if (!enumIndex) {
        enumIndex = new Map();
        for (const [group, entries] of Object.entries(englishEnums)) {
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
    },
  };
}

/**
 * Translate one server message. `format` renders a catalog key with values
 * in the target language; `tEnum` (optional) translates an enum reference.
 * Returns the English text unchanged when there's no catalog entry or the
 * translation fails.
 */
export function translateServerMessage(
  matcher: ServerTextMatcher,
  text: string,
  format: (key: string, params: Record<string, string>) => string,
  tEnum?: (ref: string) => string,
): string {
  if (!text) return text;
  const match = matcher.match(text);
  if (!match) return text;
  const params = { ...match.params };
  if (tEnum) {
    for (const [name, value] of Object.entries(params)) {
      if (PROPER.test(name)) continue;
      const ref = matcher.enumRef(value);
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
  for (const name of Object.keys(params)) params[name] = `⁨${params[name]}⁩`;
  try {
    return format(match.key, params);
  } catch {
    return text;
  }
}

/** Fill a catalog template's {placeholders} (no ICU plural/select). */
export function fillTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (whole, name: string) => (name in params ? params[name]! : whole));
}
