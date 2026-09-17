# InfluenceOS — UI/UX Audit

**Audit HEAD:** `85b6c852` · Static component-level review (Agent B6) + lead live browser sweep (`RUNTIME_BROWSER_AUDIT.md`). Live cross-browser (Firefox/WebKit) and a full responsive matrix were **not** run (Chromium-only sandbox) — flagged as WAVE-5 acceptance work.

## Verdict
**Above-average for a young product (~7/10 design maturity).** The foundation is real: HSL CSS-variable design tokens (semantic, complete in **both** light and dark), one shadcn/Radix + CVA component library, one icon family (Lucide, 64 imports, no other icon libs), one toast lib (sonner), near-zero ad-hoc hex. Runtime is clean (no console/hydration errors across 12 pages). The problems are **execution details** — RTL logical properties, a few missing primitives, code-splitting / `next/image`, and a handful of ARIA attributes — **not a broken foundation**. Do **not** rip-and-replace the design system.

## Findings
| ID | Sev | Area | Finding | Evidence |
| --- | --- | --- | --- | --- |
| UX-01 | **P2** | RTL | Search inputs use physical `absolute left-3` icon + `pl-9` padding that **don't flip in Arabic** → icon overlaps text in RTL. Repeats across 8 inputs | `directory-filters.tsx:56/62`, content-wall, platform-client, audit-client, add-influencer-form/dialog, campaign-filters |
| UX-02 | P3 | Components | No shared `Table` primitive — 6 hand-rolled `<table>` with duplicated `divide-y` and inconsistent `min-w-[560..760]` | `directory-results.tsx:153` +5 |
| UX-03 | P3 | RTL | Modal/sheet close "X" pinned physical `right-4` (not logical `end-4`) → wrong corner in RTL | `ui/dialog.tsx:43`, `ui/sheet.tsx:55` |
| UX-04 | P3 | A11y | Active nav link conveyed by **colour only**, no `aria-current="page"` | `shell/sidebar.tsx:20-33` |
| UX-05 | P3 | A11y | Hand-rolled tab buttons with `role=tab`/`aria-selected` but no `aria-controls`/`tabpanel`/arrow-key nav — duplicates the real Radix `Tabs` | `directory-results.tsx:65-84` |
| UX-06 | P3 | Perf | `recharts` (~90 kB) statically imported into the influencer-detail chunk; `next/dynamic` used **0×** app-wide (no code-splitting of heavy libs) | `follower-chart.tsx:6` |
| UX-07 | P3 | Perf/CLS | Raw `<img>` (with `eslint-disable no-img-element`) in 8 places; only **1** `next/image` in the whole app → no resize/lazy/intrinsic-size (CLS + bandwidth) | `content-card.tsx:21` +7 |
| UX-08 | P3 | Tokens | Literal `text-white`/`bg-white` on themed surfaces instead of `*-foreground` tokens — the one crack in an otherwise token-pure system | `directory-results.tsx:75`, `sidebar.tsx:44`, `avatar.tsx:31`, `switch.tsx:21` |
| UX-09 | P3 | A11y | Icon-only buttons labelled via `title=` not `aria-label` (no focus tooltip; inconsistent with the rest of the app) | `notes-panel.tsx:118/129`, `social-accounts-panel.tsx:272-293` |
| UX-10 | P4 | A11y | Spinner has no `role="status"`/label; **0** `aria-live` regions app-wide (toasts are covered by sonner) | `ui/spinner.tsx:4` |
| UX-11 | P4 | IA | Notifications duplicated (nav item **and** topbar bell); command-palette quick-actions cover only 3 of 5 quick-add kinds (missing cost, brand); flat 9-item ungrouped nav; the Feature-Flags settings card deep-links into the Platform page | shell + settings |
| UX-12 | P4 | Perf | High `'use client'` ratio (63/110 files) | app-wide |
| UX-13 | P3 | IA | Global search is a **capped command palette** (8/type, no relevance, no "see all") — a record past the top 8, or anything in notes/deliverables, is unfindable | `search.service.ts`, command palette |

## Verified non-issues (not raised)
Full light+dark token parity; status conveyed by **text labels** not colour alone (dot on `ContentStatusBadge`); no server+client double-fetch (`Promise.all` + react-query `initialData` seeding); reasonable `staleTime`/refetch config; lists are paginated/infinite (virtualization not needed at current scale); shell icon controls have `aria-label`; Radix handles dialog focus-trap.

## Highest-value UI/UX fixes (ranked)
1. **RTL logical-property pass** (UX-01/03/08) — adopt `ms-*/me-*/ps-*/pe-*/start/end` and a lint rule banning physical `left/right/ml/mr/pl/pr` in components; fixes Arabic layout properly. **P2.**
2. **Shared `ui/table.tsx` primitive** (UX-02) — collapse the 6 hand-rolled tables into one accessible, consistently-dense component. **P3.**
3. **A11y sweep** (UX-04/05/09/10) — `aria-current`, replace hand-rolled tabs with Radix `Tabs`, `aria-label` on icon buttons, `role="status"` on spinners. **P3.**
4. **Perf hygiene** (UX-06/07) — `next/dynamic` for recharts, `next/image` for content/avatar imagery. **P3.**
5. **IA cleanup** (UX-11/13) — group the nav, de-duplicate notifications, a real search results page, complete the quick-add menu. **P3/P4.**

Concrete token/house-rule proposal in `DESIGN_SYSTEM_PROPOSAL.md`.
