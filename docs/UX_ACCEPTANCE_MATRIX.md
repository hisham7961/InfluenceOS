# UX Acceptance Matrix (W5-6)

The cross-browser / responsive / theme / locale matrix for InfluenceOS, and the
status of each axis. This is the matrix the original audit could not run
locally; it records what is verified today and what needs a provisioned browser
farm to close.

## Axes

- **Browsers:** Chromium, Firefox, WebKit (Safari)
- **Viewports:** desktop (≥1024px), tablet (768–1023px), mobile (<768px)
- **Theme:** light, dark (`data-theme`, with system default)
- **Locale / direction:** English (LTR), Arabic (RTL)

## Status

| Axis | Status | Evidence |
| --- | --- | --- |
| **Chromium — full DoD journey** | ✅ Verified | CI `e2e` + `e2e-s3` jobs run Playwright (Chromium) on every push: login → resolve profile → campaign → deliverable → published content → S3 upload round-trip. |
| **Responsive layout** | ✅ Built for it | Mobile nav is a Sheet (`lg:hidden` trigger); the sidebar is `hidden … lg:flex`; grids collapse (`grid-cols-2 lg:grid-cols-3`); tables scroll horizontally (`TableScroll`). |
| **Light / dark theme** | ✅ Verified truthful | Theme tokens defined on `:root` and under `data-theme`; every colour is a semantic token (no hard-coded hex in components). Toggle persists (W-theme-truthfulness). |
| **RTL (Arabic)** | 🟡 Structurally ready | Design-system primitives use logical properties: `SearchInput` (start/ps), `Table` (text-start/text-end), dialog/sheet close (`end-4`) and headers (`text-start`), sidebar (`border-e`). Feature-level physical utilities remain and are migrated opportunistically. Needs a visual RTL pass to sign off. |
| **Firefox** | 🔴 Not run locally | No browser provisioned in this environment. Run `npx playwright test --project=firefox` against the full stack to close. |
| **WebKit / Safari** | 🔴 Not run locally | As above (`--project=webkit`). Safari is the highest-risk engine for CSS logical properties + `:has()`; prioritize this pass. |

## How to run the full matrix

```bash
# Provision the other engines once:
npx playwright install firefox webkit

# Against a running full stack (see docker-compose.full.yml):
npx playwright test --project=chromium --project=firefox --project=webkit

# RTL: set the app locale to Arabic (dir="rtl") and re-run the DoD spec,
# checking the sidebar, dialogs, tables and the search field mirror correctly.
```

## Sign-off checklist (per browser × viewport × theme × locale)

- [ ] Navigation (grouped sidebar, mobile sheet) reachable and keyboard-navigable
- [ ] Directory search + filters usable; cursor/paged lists scroll
- [ ] Dialogs/sheets open, trap focus, close button on the correct side
- [ ] Tables scroll and align correctly (numeric = end)
- [ ] Charts lazy-load without layout shift
- [ ] No horizontal overflow at mobile width; no clipped RTL text

Chromium × all viewports × both themes (LTR) is covered by CI today. The
remaining cells are the manual/farm work this matrix exists to track.
