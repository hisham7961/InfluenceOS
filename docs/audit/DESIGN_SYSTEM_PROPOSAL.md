# InfluenceOS — Design System Proposal

**Audit HEAD:** `85b6c852`. This is **additive**, not a rewrite. InfluenceOS already has a real design system (HSL CSS-variable tokens, semantic light+dark, one shadcn/Radix+CVA component library, one Lucide icon family, sonner toasts, ~zero ad-hoc hex). The proposal below fills the four gaps the audit found: **logical (RTL-safe) utilities, foreground-pairing discipline, a formal type/spacing/radius/elevation/motion scale, and two missing primitives.** Keep every good existing convention.

**MCP note:** no Figma MCP and no shadcn MCP were connected in this session, so this proposal is expressed as **code-level tokens + component contracts** (directly implementable in Tailwind + the existing `ui/` folder) rather than a Figma file. If a Figma library is desired, this token set is the source to mirror.

## 1. Colour tokens — keep as-is, add two rules
Existing semantic tokens (`--background`, `--foreground`, `--card`, `--muted`, `--brand`, `--accent`, status colours) are HSL vars with full dark parity. **Rules to add:**
- **Foreground pairing (house rule):** never use literal `text-white`/`bg-white` on a themed surface; every surface token has a paired `-foreground`. Fix UX-08 sites.
- **Status semantics:** keep the existing text-label + dot pattern (colour is never the only signal). Define the canonical set: `draft / in-review / needs-changes / approved / scheduled / live / removed / overdue` (this expands with the WAVE-3 review workflow).

## 2. Typography scale (formalize)
Introduce named steps so components stop hand-picking `text-*`:
`display` (28/36 semibold) · `h1` (22/30) · `h2` (18/26) · `h3` (16/24) · `body` (14/22) · `small` (13/20) · `caption` (12/16 muted) · `mono` (numeric/IDs). Numbers in tables/KPIs use `tabular-nums`.

## 3. Spacing & layout
4px base scale (`1=4 … 6=24 … 8=32`). Page gutter 16px min at all widths. Card padding `20`; section gap `24`; form control gap `12`. Ban `padding` shorthand that zeroes side gutters on outer wrappers (responsive rule).

## 4. Radius & elevation
Radius: `sm 6 · md 10 · lg 14 · pill 999`. Elevation: `flat` (border only) · `raised` (`shadow-sm`) · `pop` (`shadow-pop`, dialogs/menus). One shadow token per level — audit found inconsistent one-off shadows; consolidate.

## 5. Motion
`fast 120ms` (hover/press) · `base 200ms` (enter/leave) · `slow 320ms` (dialog/sheet). Easing `ease-out` in, `ease-in` out. Respect `prefers-reduced-motion`.

## 6. Logical-property (RTL) system — the highest-value addition
- Replace physical `left/right`, `ml-/mr-`, `pl-/pr-`, `text-left/right` with logical `start/end`, `ms-/me-`, `ps-/pe-`, `text-start/end` **in components** (Tailwind supports these).
- Add an ESLint rule / PR checklist item banning physical directional utilities in `src/components` and `src/app`.
- Fix the input-icon pattern (UX-01) once, in a shared `ui/search-input.tsx`, so all 8 call sites inherit it.

## 7. Icon system (keep Lucide; codify usage)
- One family: **Lucide** (already 64 imports, no mixing). Standard sizes `14 / 16 / 18 / 20`; stroke `1.75`.
- Icon + label is the default; **icon-only controls must carry `aria-label`** (not `title=`) and a tooltip.
- Destructive icons use the `destructive` token; status icons use status tokens; never colour-only.

## 8. Component primitives to add / standardize
| Primitive | Action |
| --- | --- |
| `ui/table.tsx` | **NEW** — one accessible, density-consistent table; migrate the 6 hand-rolled tables (UX-02). |
| `ui/search-input.tsx` | **NEW** — RTL-safe icon+input (fixes UX-01 in one place). |
| `ui/tabs` | Use Radix `Tabs` everywhere; remove the hand-rolled `role=tab` buttons (UX-05). |
| `ui/data-list` / KPI tile | Standardize the dashboard/report stat tiles (`tabular-nums`, one layout). |
| `ui/empty-state` | Already good — extend with an illustration/action slot for the new workflows. |
| Chart container | Wrap recharts in a lazy (`next/dynamic`) container with a fixed `aspect-ratio` box (fixes UX-06 + CLS). |

## 9. Adoption plan (low-risk, incremental — WAVE 5)
1. Land the token scale + logical-utility lint rule (no visual change; guards future drift).
2. Introduce `ui/table.tsx` + `ui/search-input.tsx`; migrate call sites file-by-file behind the unchanged public props so the browser DoD selectors keep passing.
3. A11y sweep (aria-current, Radix tabs, aria-labels, role=status).
4. Perf: `next/dynamic` recharts, `next/image` imagery.
5. Cross-browser + responsive + RTL acceptance run (Chromium/Firefox/WebKit; desktop/tablet/mobile; light/dark; EN/AR) — the matrix this audit could not run locally.

**Do not** adopt a new component library, switch icon families, or restructure the token architecture — the existing one is sound.
