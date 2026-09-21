# Localization (i18n) architecture

InfluenceOS is bilingual: English (`en`, default) and professional Arabic
(`ar`). This is the one and only localization system — built on
[`next-intl`](https://next-intl.dev). Never introduce a second i18n library
or a parallel translation mechanism.

See also `docs/localization/ar-glossary.md` for approved Arabic terminology.

## Locale detection & persistence

- `apps/web/src/i18n/request.ts` reads the `locale` cookie (`en`/`ar`,
  default `en`) on every server request and resolves the message set for
  that locale.
- `apps/web/src/components/shell/locale-toggle.tsx` flips the cookie AND
  persists the choice to the signed-in user's account
  (`api.auth.updatePreferences({ locale })`), then calls `router.refresh()`
  — the current route/page is preserved, never redirected to home.
- `apps/web/src/app/layout.tsx` sets `<html lang dir>` from the resolved
  locale on every request — `dir="rtl"` for Arabic, `dir="ltr"` for English.
  Never rely on a component-level direction override for the document root.

## Message files

Each locale's catalog lives as one JSON file per namespace, not one giant
blob:

```
apps/web/messages/
  en/
    nav.json
    common.json
    dashboard.json
    auth.json
    empty.json
    enums.json
    <feature>.json  ← one per feature area
    index.ts        ← imports and merges every namespace above
  ar/
    (same file set, same structure)
```

`index.ts` is the single place that registers a namespace — when you add a
new `<feature>.json` pair, add the import + entry in **both**
`messages/en/index.ts` and `messages/ar/index.ts`. This keeps individual
namespace files free of merge conflicts when multiple people/agents work on
different features in parallel; only `index.ts` itself is a shared,
sequentially-edited file.

`apps/web/src/i18n/request.ts` imports `messages/{locale}/index` (the merged
object) — this is the only place that changed to support the per-namespace
layout; `next-intl`'s API and resolution behavior are otherwise untouched.

## Adding a translation key

1. Add the English string to the right namespace file under `messages/en/`
   (create a new namespace file if none fits — see the suggested namespace
   list below).
2. Add the Arabic translation to the **same key path** in
   `messages/ar/<namespace>.json`. Write natural, professional MSA — see the
   glossary — never a literal machine translation.
3. Register the namespace in both `index.ts` files if it's new.
4. Use the key from a component (see below).
5. Run the parity check (`pnpm --filter @influenceos/web test:i18n-parity`,
   also part of the regular test suite) — it fails the build if `en` and
   `ar` don't have identical key structures.

Suggested namespaces (adapt as needed — avoid dumping everything into
`common`): `nav`, `common`, `auth`, `dashboard`, `brands`, `influencers`,
`campaigns`, `deliverables`, `submissions`, `content`, `logistics`,
`collaboration`, `inspiration`, `dataQuality`, `reports`, `notifications`,
`settings`, `users`, `permissions`, `countries`, `activity`, `finance`,
`usageRights`, `validation`, `errors`, `emptyStates`, `enums`.

### Key naming

Keys describe semantic meaning, not the English sentence:

- Good: `logistics.requestAddressClarification`
- Bad: `text123`, `logistics.pleaseRequestAnAddressClarificationFromTheCreator`

Don't over-reuse one generic key across contexts that need different
grammar — `review` as a noun and `review` as a verb/button-label may need
separate keys if the natural Arabic differs.

## Using translations in components

**Server Components** (the default in the App Router — prefer this,
never convert a component to `'use client'` just to translate it):

```tsx
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('logistics');
  return <h1>{t('title')}</h1>;
}
```

**Client Components** (`'use client'`):

```tsx
import { useTranslations } from 'next-intl';

export function ShipmentBadge() {
  const t = useTranslations('logistics');
  return <span>{t('shipment')}</span>;
}
```

Never build a sentence by concatenating translated fragments with dynamic
data (`t('creator') + creator.name + t('added')`). Use interpolation inside
one complete, translatable string instead:

```tsx
t('creatorAdded', { name: creator.name })
// en: "{name} was added to the roster."
// ar: "تمت إضافة {name} إلى القائمة."
```

### Enum / status labels

Never write a switch/ternary mapping an enum value to a label in a
component, and never import the English-only `*_LABELS` maps from
`@influenceos/shared` for display text (those stay as the source the
`enums.json` English side was seeded from, and remain available for
non-UI/export uses — they are not a rendering path). Use
`apps/web/src/lib/enum-labels.ts`:

```tsx
const t = useTranslations('enums'); // or getTranslations('enums') server-side
enumLabel(t, 'campaignStatus', campaign.status)
```

Every enum family and value is defined once in `messages/{locale}/enums.json`.

### Pluralization

Arabic pluralization rules differ substantially from English — do not
concatenate a count with a fixed noun (`3 مؤثرون` is grammatically wrong for
most counts). Use next-intl's ICU `plural`/`select` syntax where a natural
plural sentence is needed, or prefer a neutral, grammatically-stable
construction (`عدد المؤثرين: 3`) when the plural forms would be fragile or
overly complex for a UI label.

### Mixed-direction (bidi) content

User/database content that may contain a mix of Arabic and inherently-LTR
data (emails, URLs, tracking numbers, `@handles`, phone numbers, SKUs) must
never visually scramble inside RTL UI. Use the primitives in
`apps/web/src/components/common/bidi-text.tsx`:

- `<BidiText>` — general text that may be Arabic, English, or mixed (e.g. a
  creator display name). Uses `dir="auto"` with per-element isolation.
- `<LtrText>` — content that must always read left-to-right regardless of
  locale: emails, URLs, tracking numbers, phone numbers, IDs, SKUs.

Do not manually inject LRM/RLM Unicode marks; use these primitives instead
so the behavior is consistent and auditable in one place.

## Proper nouns and non-translatable content

**Never translate:**

- The product name `InfluenceOS`.
- Social platform names: Instagram, TikTok, YouTube, Snapchat, X.
- Brand names (from the database — e.g. JUVELAB, MEDEE, Vitamin Factory),
  courier names (DHL, Aramex).
- Technical identifiers where established: API, URL, SKU, OAuth, S3, CSV, ID.
- User/database content: creator names, campaign names, captions, comments,
  notes, addresses, tracking numbers, external social content. This data is
  never machine-translated and is rendered exactly as stored.
- Backend enum values / API identifiers (`PUBLISHED`, `GENERAL_MANAGER`,
  etc.) — only their **display labels** are localized, via `enums.json`;
  the stored value, database schema, and API responses stay in English.

**Translate:** every piece of interface chrome — labels, buttons, headers,
placeholders, validation messages, toasts, empty states, confirmation
dialogs, filters, table headers, pagination, enum/status badges.

## Routing

Locale is presentation-only. There is no `/ar/...` URL prefix and no
localized route slugs — switching language never changes the URL or drops
the user's current page/filters.

## Translation-parity testing

`apps/web/src/i18n/parity.ts` walks the merged `en`/`ar` message trees and
asserts structural equality (same keys at every level, no missing/extra
namespace). It fails loudly — no silent fallback — if a key exists in one
locale and not the other. It's exercised by
`apps/web/src/i18n/parity.test.ts`, part of the regular `pnpm test` /
`pnpm --filter @influenceos/web test` run and therefore CI.

## Performance

`NextIntlClientProvider` (in the root layout) receives only the ACTIVE
locale's merged messages — English and Arabic are never both sent to the
browser in the same request. Server Components resolve translations without
sending any message JSON to the client at all. Adding namespaces does not
meaningfully change this: the merge happens at the module level via static
imports, not a runtime fetch.
