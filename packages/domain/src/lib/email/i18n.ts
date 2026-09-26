import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServerTextMatcher,
  fillTemplate,
  translateServerMessage,
  type Catalog,
  type EnumCatalog,
  type ServerTextMatcher,
} from '@influenceos/shared';

/**
 * Emails in the reader's language (P2.6). Notification text is the same
 * English the app stores; it's translated with the web app's serverText
 * catalog (apps/web/messages/<locale>/serverText.json) and enum labels
 * (enums.json) — one catalog for the screen and the inbox. The files are
 * read from the repository at run time (the worker image contains it;
 * MESSAGES_DIR overrides the location). Without them emails stay English.
 */
export type EmailLocale = 'en' | 'ar';

export const emailLocale = (value: string | null | undefined): EmailLocale => (value === 'ar' ? 'ar' : 'en');

function messagesDir(): string | null {
  const candidates = [
    process.env.MESSAGES_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../apps/web/messages'),
    path.resolve(process.cwd(), 'apps/web/messages'),
    path.resolve(process.cwd(), '../web/messages'),
    path.resolve(process.cwd(), '../../apps/web/messages'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(path.join(p, 'en', 'serverText.json'))) ?? null;
}

const cache = new Map<string, unknown>();
function load<T>(locale: EmailLocale, namespace: string): T | null {
  const key = `${locale}/${namespace}`;
  if (cache.has(key)) return cache.get(key) as T | null;
  let value: T | null = null;
  const dir = messagesDir();
  if (dir) {
    try {
      value = JSON.parse(fs.readFileSync(path.join(dir, locale, `${namespace}.json`), 'utf8')) as T;
    } catch {
      value = null;
    }
  }
  cache.set(key, value);
  return value;
}

let matcher: ServerTextMatcher | null | undefined;
function getMatcher(): ServerTextMatcher | null {
  if (matcher === undefined) {
    const en = load<Catalog>('en', 'serverText');
    const enums = load<EnumCatalog>('en', 'enums');
    matcher = en ? createServerTextMatcher(en, enums ?? {}) : null;
  }
  return matcher;
}

/** The label of an enum value ("deliverableType", "REEL") in the locale, or a readable fallback. */
export function enumText(group: string, key: string, locale: EmailLocale): string {
  const label = load<EnumCatalog>(locale, 'enums')?.[group]?.[key] ?? load<EnumCatalog>('en', 'enums')?.[group]?.[key];
  return label ?? key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** A notification kind's label ("Mention") from the web app's notifications catalog. */
export function categoryText(category: string, locale: EmailLocale): string {
  type Ns = { categories?: Record<string, string> };
  return (
    load<Ns>(locale, 'notifications')?.categories?.[category] ??
    load<Ns>('en', 'notifications')?.categories?.[category] ??
    enumText('', category, locale)
  );
}

/** A server message (notification title/body) in the reader's language. */
export function serverText(text: string, locale: EmailLocale): string {
  if (!text || locale === 'en') return text;
  const m = getMatcher();
  const catalog = load<Catalog>(locale, 'serverText');
  if (!m || !catalog) return text;
  return translateServerMessage(
    m,
    text,
    (key, params) => {
      const template = catalog[key];
      if (!template) throw new Error('missing');
      return fillTemplate(template, params);
    },
    (ref) => {
      const [group, key] = ref.split('.');
      if (group === 'country') return new Intl.DisplayNames([locale], { type: 'region' }).of(key!) ?? key!;
      const label = load<EnumCatalog>(locale, 'enums')?.[group!]?.[key!];
      if (!label) throw new Error('missing');
      return label;
    },
  );
}

/** Test hook: forget loaded catalogs. */
export function resetEmailCatalogs(): void {
  cache.clear();
  matcher = undefined;
}
