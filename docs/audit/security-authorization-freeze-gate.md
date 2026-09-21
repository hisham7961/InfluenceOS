# Security & Authorization Freeze Gate — Audit Report

**Branch:** `claude/new-session-2rsnjm`
**Starting SHA:** `10c7d1a` (unchanged since the prior Final Completion Pass report)
**Final SHA:** `3e4a9a4`
**Date:** 2026-09-21

This is the audit deliverable for the Security & Authorization Freeze Gate pass — a
pre-freeze review of every read/write path's Role Profile, Capability, Brand Scope,
and Country Scope enforcement. It complements (and does not replace) the running
integration test suite, which is the actual proof; this document explains what was
checked, what was found, and what changed.

---

## 1. Authorization architecture (source of truth)

| Concern | Source of truth |
|---|---|
| Actor / request context | `packages/domain/src/context.ts` — `DomainContext.actor: Actor \| null`. `null` = system context (worker/seed), bypasses all actor-based gates. |
| Legacy role | `User.role: UserRole` (`ADMIN` / `STAFF` / `VIEWER`) |
| Role Profile | `User.roleProfile: RoleProfile?` — optional finer layer over the legacy role; `null` = legacy/unprofiled |
| Capability resolution | `packages/domain/src/lib/capabilities.ts` — `resolveEffectiveCapabilities()` is the ONE pure resolution function; both the live path and the Admin "Permission Preview" call it |
| Capability overrides | `UserCapability { userId, capability, granted }` — explicit per-user grant/revoke, always wins over the Role Profile default (either direction) |
| Brand scope | `UserBrandAccess { userId, brandId }` — presence-based opt-in; `packages/domain/src/lib/scope.ts::scopedBrandIds()` |
| Country scope | `UserCountryAccess { userId, countryCode }` — same pattern; `scopedCountryCodes()` |
| Central gates | `packages/domain/src/lib/authz.ts` — `requireActor`, `requireAdmin`, `requireOwnerOrAdmin`, `requireCapability`, `requireAnyCapability` |
| Admin bypass | Unconditional in all four layers above (`role === 'ADMIN'` → all capabilities, unscoped brand, unscoped country, passes every `require*` gate) |

### Opt-in scoping (by design, not a bug)

`scopedBrandIds()` / `scopedCountryCodes()` return `null` (meaning "unscoped — sees
everything") for an ADMIN, a system context, **or a user with zero explicit
`UserBrandAccess`/`UserCountryAccess` rows**. This is a deliberate design choice
carried over from the Advanced Roles pass: existing users are unaffected until an
admin explicitly grants scoped access. Confirmed correct and unchanged this pass.

### The centralization rule

`authz.ts`'s own doc comment states it is "the ONE way a new operational check
should gate access" — new code must never scatter `actor.role === 'X'` comparisons.
A full grep-based audit (Task 2 of the architecture research work-stream) found
**13 total matches** for `actor.role ===` / `.roleProfile ===` style checks outside
the central helpers, of which **11 were the central helpers' own implementation**
(legitimate by definition) and **2 were minor duplications** in
`inspiration.service.ts` (`update()`'s pin-check and `remove()`'s ownership-check)
that reimplemented `requireOwnerOrAdmin()` inline instead of calling it. Both were
fixed this pass — see §8.

---

## 2. Role Profile × Capability matrix

| Capability | ADMIN | GENERAL_MANAGER | OPERATIONS_MANAGER | LOGISTICS | INFLUENCER_MANAGER | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| USERS_MANAGE | ✓ | | | | | |
| ROLES_MANAGE | ✓ | | | | | |
| BRANDS_VIEW | ✓ | ✓ | ✓ | | ✓ | ✓ |
| BRANDS_MANAGE | ✓ | | | | | |
| CAMPAIGNS_VIEW | ✓ | ✓ | ✓ | | ✓ | ✓ |
| CAMPAIGNS_MANAGE | ✓ | ✓ | | | | |
| INFLUENCERS_VIEW | ✓ | ✓ | ✓ | | ✓ | ✓ |
| INFLUENCERS_MANAGE | ✓ | ✓ | | | ✓ | |
| CONTENT_VIEW | ✓ | ✓ | ✓ | | ✓ | ✓ |
| CONTENT_MANAGE | ✓ | ✓ | | | | |
| UGC_REVIEW | ✓ | ✓ | ✓ | | | |
| LOGISTICS_VIEW | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| LOGISTICS_MANAGE | ✓ | ✓ | | ✓ | | |
| LOGISTICS_ASSIGN | ✓ | | | ✓ | | |
| LOGISTICS_ADDRESS_VIEW | ✓ | ✓ | | ✓ | | |
| LOGISTICS_ADDRESS_EDIT | ✓ | | | ✓ | | |
| LOGISTICS_ISSUE_MANAGE | ✓ | | | ✓ | | |
| FINANCE_VIEW | ✓ | ✓ | | | | |
| FINANCE_MANAGE | ✓ | | | | | |
| REPORTS_VIEW | ✓ | ✓ | ✓ | | | ✓ |
| OPERATIONS_VIEW | ✓ | ✓ | ✓ | | | ✓ |
| SYSTEM_SETTINGS_MANAGE | ✓ | | | | | |
| INTEGRATIONS_MANAGE | ✓ | | | | | |

Notes worth calling out explicitly (each independently verified live via API in the
role-profile matrix and browser-verification work-streams):

- **GENERAL_MANAGER has LOGISTICS_MANAGE but not LOGISTICS_ADDRESS_EDIT** — "wide
  operational data, not system config" per the capability file's own comment. GM
  can reassign shipments, update courier/tracking/status; GM cannot edit a
  recipient's phone/address without an explicit override.
- **OPERATIONS_MANAGER lacks LOGISTICS_ADDRESS_VIEW** — sees that a shipment
  exists and its status/addressHealth, never the literal address/phone.
- **INFLUENCER_MANAGER has INFLUENCERS_MANAGE but not CAMPAIGNS_MANAGE** —
  campaign-roster mutations (`campaign-influencer.service.ts`, `sourcing.service.ts`)
  are gated by `requireAnyCapability(['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE'])`
  specifically so this role can still manage a creator's campaign participation.
- **A legacy user with no `roleProfile`** falls back to `LEGACY_STAFF_CAPABILITIES`
  — every capability except `USERS_MANAGE`/`ROLES_MANAGE`/`SYSTEM_SETTINGS_MANAGE`/
  `INTEGRATIONS_MANAGE` — preserving pre-Advanced-Roles STAFF behavior exactly. This
  is an intentional migration safety net, confirmed unchanged this pass.
- **VIEWER** (legacy role, not just a Role Profile) is additionally blocked at the
  route layer: `apps/api/src/app.ts` rejects every non-GET request from a
  `VIEWER`-role actor globally, before any domain-layer check runs.

Capability grants **WHAT** an actor can do; it never implies **WHERE**. Every
mutation in the tables below additionally requires the correct Brand and/or Country
scope — this is the single principle the whole pass was organized around.

---

## 3. Brand scope, Country scope, and their intersection

Both scopes are resolved independently (`scopedBrandIds()`, `scopedCountryCodes()`)
and, where a resource has both dimensions, composed with **AND** semantics, never
OR — confirmed by a dedicated combined-attack test matrix (see §6). Concretely, for
an actor scoped to Brand=X and Country=Y:

| Brand | Country | Result |
|---|---|---|
| X | Y | allowed |
| X | not Y | denied |
| not X | Y | denied |
| not X | not Y | denied |

This was specifically probed on `campaign-influencer.service.ts::add()` (adding a
creator to a campaign roster — the campaign carries brand, the creator carries
country) via `authorization-freeze-gate-idor.test.ts`'s combined-matrix test,
including the "brand✗/country✓" cell that would catch an accidental OR.

### Where scope is enforced

Every list/detail/create/update query composes scope **at the Prisma query level**,
never "load all then filter in JS" — the pattern established in
`campaign.service.ts::buildWhere()` and reused throughout:

```ts
const scope = await scopedBrandIds(ctx);
where.brandId = scope ? { in: scope } : undefined;
```

For a direct-ID lookup, the equivalent is an existence check followed by
`isBrandOutOfScope(scope, record.brandId) → AppError.notFound(...)` — an
out-of-scope record returns **404**, matching this codebase's existing convention
of preferring Not Found over Forbidden for scope violations (never confirming a
record exists to an actor who isn't allowed to see it).

---

## 4. Sensitive fields

| Field group | Gate |
|---|---|
| Shipment recipient/address (`recipientName`, `phone`, `addressLine1/2`, `city`, `country`, `destinationCountryCode`, `postalCode`, `deliveryInstructions`) | `LOGISTICS_ADDRESS_EDIT`, independent of `LOGISTICS_MANAGE` |
| Influencer shipping-profile fields (`addressLine1/2`, `postalCode`, `deliveryInstructions`) | Also `LOGISTICS_ADDRESS_EDIT` — closes the "generic Influencer PATCH as a back door" gap |
| Shipment address *read* (same field set, redacted) | `LOGISTICS_ADDRESS_VIEW` |
| Provider API keys / credentials | `INTEGRATIONS_MANAGE`, ADMIN-only routes |
| User accounts, Role Profile, Capability overrides, Brand/Country access | `USERS_MANAGE`/`requireAdmin` — never auto-granted to GENERAL_MANAGER or any non-ADMIN role |
| Finance (`CampaignExpense.paidAmount`, `paymentStatus`) | `FINANCE_MANAGE` **and** the owning campaign's brand scope |
| Usage Rights | `BRANDS_MANAGE` (no dedicated capability exists; rights are brand-owned legal terms) **and** brand scope |

---

## 5. Known-Gap Closure Report

These five items were the prior report's documented, carried-forward concerns.
All five are now closed.

### 5.1 Campaign Brand Scope (HARD BLOCKER) — CLOSED

`campaign.service.ts` had **zero** actor brand-scope enforcement anywhere —
`list()`, `listCursor()`, `findByIdOrSlug()`, `create()`, `update()` all ignored
the actor's `UserBrandAccess` entirely. Fixed:

- `buildWhere()` composes `scopedBrandIds()` into every list query.
- `findByIdOrSlug()` checks scope post-fetch, 404 if out of scope.
- `create()` rejects an out-of-scope `brandId` in the input.
- `update()` rejects mutating an out-of-scope-brand campaign.
- A new, reusable `assertInScope(campaignId)` helper was added and exported for
  every other service that resolves a Campaign by ID to call instead of a raw,
  unscoped `prisma.campaign.findUnique`.

This bug class — a child resource resolving its parent Campaign without a scope
check — turned out to be **systemic**: 16 call sites across 11 files. All 16 are
now fixed (`campaign-influencer.service.ts`, `expense.service.ts`,
`sourcing.service.ts`, `note.service.ts` ×3, `campaign-operations.service.ts`,
`logistics-issue.service.ts` [verified already safe via its shipment chain],
`usage-right.service.ts`, `analytics.service.ts` [verified already safe],
`deliverable.service.ts`, `script.service.ts`, `submission.service.ts`
[scope already present, capability was missing], `bulk.service.ts`,
`attachment.service.ts`).

### 5.2 LOGISTICS_ADDRESS_EDIT independence — CLOSED

`shipment.service.ts::update()` and `influencer.service.ts::update()` now
independently gate the address-tier field set behind `LOGISTICS_ADDRESS_EDIT`,
on top of (not instead of) `LOGISTICS_MANAGE`/`INFLUENCERS_MANAGE`. A role with
`LOGISTICS_MANAGE` alone (e.g. GENERAL_MANAGER) can still update courier,
tracking, and status; it cannot silently edit a recipient's phone/address.
`create()` is deliberately not split — the initial address is supplied once as
part of standing the shipment up.

A functional side effect surfaced by browser verification (§9) — the shipment
Edit form always PATCHed every field, including unchanged address fields, which
tripped the new gate even when a GM only meant to change the courier — was fixed
by making the form send a diff-only PATCH.

### 5.3 Bulk mutation authorization — CLOSED

Every bulk mutation in `bulk.service.ts` and `bulk-influencer.service.ts` now
requires the correct Capability (not just `requireActor`) **and** the correct
Brand/Country scope, on both the Preview and Execute paths. Specific findings:

- `campaignOrThrow` (5 call sites) was an unscoped raw campaign lookup — fixed to
  delegate to `campaign.service.ts::assertInScope()`.
- `applyDeliverableTemplate`, `addInfluencers`, `importCandidatesCsv` (preview
  **and** execute) were bare `requireActor` — now `requireCapability`/
  `requireAnyCapability`.
- Per-row country-scope masking was missing from `planAddInfluencers`/
  `planCsvRow`/`bulk-influencer.service.ts`'s plan layer — an out-of-scope
  creator now masks identically to not-found in Preview, rather than leaking
  their name/status.
- A genuine side-effect bug was found and fixed in the same pass: previewing an
  `ADD_TAG` bulk action with a not-yet-existing tag name silently created the
  `Tag` row — Preview must never write.

### 5.4 Admin Users RTL — CLOSED

The table's header `<tr>` carried a physical `text-left` class that didn't mirror
under `dir="rtl"`, while the body cells (no override) correctly computed
`text-align: start`. Fixed by moving to logical `text-start` on each header cell
directly (a bare `<tr>`-level logical class doesn't propagate into `<th>` under
Chromium's table-header quirk — confirmed via live `getComputedStyle` measurement,
not just code reading). Verified live in the browser-verification pass at desktop,
1024px, and 768px, in both LTR and RTL.

### 5.5 Logistics mobile overflow — CLOSED

The Creator-column cell had `truncate` on the name span but no `max-w` constraint
on the containing `TableCell`, and the flex row lacked `min-w-0`, so truncation
was structurally inert. Fixed by adding `max-w-[180px]` (matching sibling
columns' convention) and `min-w-0` on both the flex wrapper and the inner span.
Verified live at 375px: zero page-level horizontal overflow, genuine ellipsis
truncation confirmed via `scrollWidth`/`clientWidth`.

---

## 6. Direct-ID / IDOR test matrix

A dedicated adversarial test suite
(`apps/api/test/integration/authorization-freeze-gate-idor.test.ts` and
`authorization-freeze-gate-address-fields.test.ts`, 26 tests) proves — via real
API calls, not code reading — that for Campaign, CampaignInfluencer, Expense,
Shipment (address split), and Influencer (shipping-field guard):

- A direct-ID GET on an out-of-scope-brand record returns 404, never a leak.
- A direct-ID PATCH on an out-of-scope-brand record is rejected identically,
  and the record is verified unchanged.
- CREATE with an allowed capability but an out-of-scope `brandId` is rejected.
- A capability-holding, correctly-brand-scoped actor still gets 403 without the
  right capability (proves capability and scope are independently enforced, not
  substitutable).
- Child/parent consistency: a `campaignInfluencerId` belonging to a different
  campaign (in-scope or out-of-scope brand, both tested) is rejected on Expense
  create — an arbitrary child ID is never trusted just because the parent
  context was authorized.
- Country-scope IDOR on roster `add()`: a KW-only actor cannot add an AE creator
  to an otherwise-in-scope campaign.
- The full brand×country 2×2 combined-attack matrix (§3).

A second, broader IDOR/relationship suite
(`relationship-oauth-attachment-capability.test.ts`, 13 tests) covers the newly
capability-gated `brand-influencer`, `social-account`, `creator-oauth`, and
`attachment` services the same way.

A third, targeted suite (`bulk-authz-scope.test.ts`, `security-freeze-gate-child-scope.test.ts`,
`content-saved-view-notification-freeze-gate.test.ts`, `aggregate-leak-audit.test.ts`)
covers the same pattern for bulk mutations, the remaining child-resource scope
fixes, Content/Saved-View/Notification, and every aggregate-leak fix
respectively.

No test needed its assertion loosened to pass — every denial case is a real
denial, and every positive control (the same actor acting in-scope) succeeds.

---

## 7. Aggregate leak audit

The freeze-gate spec's own example — "a KW-only user should not learn '27 Saudi
creators missing phone'" — turned out to be a real, previously-unaudited gap
class. Findings, all fixed:

| Surface | Finding |
|---|---|
| `dashboard.service.ts::pulse()`/`totalSpend()` | Unscoped when no explicit `brandId` param — any brand-scoped actor got every brand's KPIs |
| `dashboard.service.ts::whatsNew()`/`whatsNewSummary()` | An explicit out-of-scope `brandId` **overwrote** the scope filter via an object-spread key collision (last key wins) — a scoped actor could pass another brand's id and see its feed |
| `dashboard.service.ts::attentionBrandFilter()` | Zero scope check on an explicit `brandId`, ever — the most serious of this group |
| `dashboard.service.ts::upcomingContent()`/`recentActivity()` | Unscoped when `brandId` omitted |
| `data-quality.service.ts::report()`/`duplicates()` | Had brand scope but **no country-scope dimension at all** — exactly the spec's own example |
| `creator360.service.ts::assertVisible()` | Checked existence only, no brand/country check — any actor could open any creator's full 360 |
| `creator360.service.ts` panels (`snapshot`/`reliability`/`submissions`/`timeline`) | Each independently re-pulled data with no brand filter — a creator shared across an in-scope and out-of-scope brand leaked the out-of-scope brand's data into the same view once the base gate passed |
| `report.service.ts` (all 4 report types) | Composed only explicit filter params, never actor scope — `GET /reports` with no `brandId` returned every brand's campaigns/budget/spend/content |
| `search.service.ts` (all 4 entity types × 2 endpoints) | Zero scope enforcement anywhere |

All fixed the same way: `scopedBrandIds()`/`scopedCountryCodes()` composed into
the query at the database level. 13 new tests
(`apps/api/test/integration/aggregate-leak-audit.test.ts`) prove each fix with a
before/after delta against the spec's own "27 Saudi creators" framing.

---

## 8. Security Discovery Report (new findings this pass, not in the original prompt)

Per the freeze-gate spec's own instruction: "if this pass finds NEW authorization
issues, list each — do not hide them merely because they were not in the
prompt." All of the following were found and fixed:

1. **`brand-influencer.service.ts::upsert()`/`remove()`** — bare `requireActor`,
   no capability, no brand scope, on a mutation that includes `rate`/`currency`
   fields (financial). Fixed: `INFLUENCERS_MANAGE` + brand scope.
2. **`deliverable.service.ts::create()`/`update()`/`remove()`** — bare
   `requireActor`, no scope. Fixed: `CAMPAIGNS_MANAGE` + campaign brand scope.
3. **`sourcing.service.ts`** (candidate `add`/`update`/`decide`/`convert`/
   `remove`) — bare `requireActor`, and `remove()` had **zero** scope check
   at all (verified existence only, then deleted). Fixed: capability + scope on
   every mutation.
4. **`submission.service.ts::review()`** — HIGH severity: approves/rejects a
   creator's UGC submission, completing the deliverable and triggering
   payment-due state, gated by bare `requireActor`. Scope was already present;
   capability (`UGC_REVIEW` — an existing, previously-unused capability) was
   missing. Fixed.
5. **`usage-right.service.ts`** — the worst of this group: **zero** brand-scope
   enforcement anywhere (`get`/`update`/`revoke` never checked the resolved
   brand at all), plus bare `requireActor` on every mutation. Fixed:
   `BRANDS_MANAGE` + brand scope throughout.
6. **`script.service.ts::create()`/`addVersion()`** — bare `requireActor`, no
   scope. Fixed: `CAMPAIGNS_MANAGE` + conditional campaign scope.
7. **`social-account.service.ts`** (`create`/`update`/`remove`) — bare
   `requireActor`. Fixed: `INFLUENCERS_MANAGE`.
8. **`creator-oauth.service.ts::disconnect()`** — bare `requireActor`. Fixed:
   `INFLUENCERS_MANAGE`. (`callback()` correctly left untouched — authorized by
   its own signed/sealed `state` parameter, not an actor check.)
9. **`attachment.service.ts::initiate()`** — mints an upload ticket against any
   existing campaign/deliverable/script/influencer/note by ID with only an
   existence check, no capability or scope check. Fixed with a per-target-type
   resolver: campaign context → capability + `assertInScope`; influencer
   context → capability + country scope.
10. **`inspiration.service.ts::create()`** — bare `requireActor`. Fixed:
    `CONTENT_MANAGE`. Also fixed the two centralization bypasses noted in §1
    (inline role checks → `requireOwnerOrAdmin`).
11. **`note.service.ts::listForInfluencer()`/`listForContent()`** — reachable by
    direct ID with **zero** scope check (the file's `list()`/`create()`/`pin()`
    already had it via `resolveContext()`+`assertInScope()`, but these two
    older functions bypassed that path entirely). Fixed: country scope on the
    influencer path, brand scope on the content path.
12. **Aggregate leak class** — see §7 in full; 9 distinct fixes across 5 files.
13. **`auth.service.ts`** had zero audit-log (`logActivity`) coverage for
    sensitive admin actions. Fixed for `updateUser` (role/profile/brand/
    country/capability changes, active/inactive), `resetUserPassword`, and
    `createUser`, `removeUser`, matching the existing `logActivity` convention
    used elsewhere in the codebase.
14. **`shipment-detail-sheet.tsx` (web)** — the unified Fulfilment Details form
    always PATCHed every field, tripping the new `LOGISTICS_ADDRESS_EDIT` gate
    even for a courier-only edit by a role that correctly holds
    `LOGISTICS_MANAGE` but not the address capability. Not a security defect
    (backend correctly rejected) but a real functional regression for a role
    this pass explicitly validates. Fixed with a diff-only PATCH.

None of the above are BLOCKER-severity in their final, fixed state — they are
listed here as the *discoveries*, all now closed. See §11 for the current
BLOCKER/HIGH count (zero).

---

## 9. Browser verification (SEC-10)

Real-browser Playwright checks (not code reading) against a live dev stack,
covering VIEWER, LOGISTICS (KW-scoped), INFLUENCER_MANAGER (KW-scoped),
GENERAL_MANAGER, and ADMIN. 17/17 checks passed. Full detail in the session
record; summary:

- Every scope/capability boundary exercised in the browser held exactly as the
  backend integration suite already proves — no case where the UI allowed or
  showed something the backend should have (but didn't) block.
- VIEWER's hard read-only gate confirmed both by UI (no mutation controls
  reachable in the sense that matters) and, critically, by firing a direct API
  mutation from the same authenticated session — rejected regardless of UI
  state.
- RTL Admin Users fix and Logistics mobile fix both confirmed live, with
  screenshots, not just an isolated markup reproduction.
- Two non-security findings, both already addressed: the diff-only-PATCH fix
  (§8.14), and a systemic, pervasive observation that this app has **no
  client-side capability-based UI gating** anywhere except three ADMIN-only
  settings pages — every "New"/"Edit"/bulk-action control renders
  unconditionally for any authenticated user who can reach the page. This is
  explicitly MEDIUM/cosmetic, not a BLOCKER, per the freeze-gate spec's own
  classification rule ("UI shows something it shouldn't, but the click fails
  safely") — documented here as known debt, not fixed (would be a UI redesign,
  out of scope for this pass per its own "no feature expansion" rule).

---

## 10. Session, cache, and audit-trail review (SEC-8)

- **Inactive users lose access immediately, not just at next login.** Traced the
  full per-request path: `app.ts`'s `onRequest` hook calls `resolveActor()`
  fresh on every request (no caching); `auth.service.ts::authenticate()` does a
  fresh DB read of the session + `user.isActive` on every call. `updateUser()`
  additionally calls `revokeAllSessions()` on deactivation/role change, so the
  session row itself is marked revoked immediately. Confirmed via
  `session-binding.test.ts` and `user-lifecycle.test.ts`.
- **No authorization caching exists.** `resolveCapabilities()`/
  `scopedBrandIds()`/`scopedCountryCodes()` all read Postgres fresh on every
  call — grepped the domain package for any cache/Redis/memoization usage;
  the only Redis usage found is an unrelated health-check ping. A Role
  Profile, Brand access, Country access, or Capability-override change takes
  effect on the actor's very next request.
- **Permission-override precedence confirmed**: an explicit `UserCapability`
  override always wins over the Role Profile default, in either direction
  (documented as a code comment on `resolveEffectiveCapabilities`).
- **Audit trail**: fixed per §8.13. `createUser`/`resetUserPassword`/
  `removeUser` now log; `updateUser`/`setUserBrandAccess`/
  `setUserCountryAccess`/`setUserCapabilityOverrides` already did (or were
  fixed alongside).

---

## 11. Findings summary

| Severity | Count | Status |
|---|---|---|
| BLOCKER | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | Documented, not fixed (no client-side capability-based UI gating app-wide — backend is the sole and, everywhere tested, correctly-enforcing gate; a UI redesign is out of this pass's scope) |
| LOW | 1 | Fixed (shipment form diff-only PATCH) |

Every other finding discovered this pass (§8, §7) has been fixed and is covered
by a regression test. Remaining, pre-existing, explicitly out-of-scope debt
(unchanged from the prior report, not touched this pass per its own "no feature
expansion" rule): the app-wide RTL bidi corruption of mixed English/Arabic
strings outside the two security-critical surfaces fixed this pass.

---

## 12. Test gate summary

- `npx pnpm --filter @influenceos/domain typecheck` — clean
- `npx pnpm --filter @influenceos/api typecheck` — clean
- `npx pnpm --filter @influenceos/web typecheck` — clean
- `npx pnpm --filter @influenceos/web lint` — clean
- Domain unit tests: 33/33 passed
- API contract tests: 6/6 passed
- API integration suite: 393/395 passed, 2 skipped (env-gated), 0 failed, across
  76 test files (75 passed, 1 fully-skipped file)
- Browser verification: 17/17 Playwright checks passed
- CI on final SHA `3e4a9a4`: see the delivered chat report for the confirmed run
  result.

Two intermediate checkpoint commits (`acd5793`, `b73e30d`) showed transient CI
red during this pass — both were bugs in newly-added *test code* from
concurrently-landing work-streams (a `pageSize` over the API's limit in one new
test, and two not-yet-finished assertions in another), not defects in
application/authorization logic. Both were fixed in the very next checkpoint
(`f499a81`), which passed CI cleanly, and are covered by the full regression run
above.
