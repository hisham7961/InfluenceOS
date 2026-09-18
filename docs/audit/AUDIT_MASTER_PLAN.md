# InfluenceOS — Audit Master Plan

**Audit HEAD:** `85b6c8522deb58a2a9528d13151d1ee75b66f1fd` · **Prior freeze baseline:** `410c587…` (still valid; not overwritten). **CI:** run #18 **FAILED** (MinIO pull). **Agents used:** 14 independent specialists (isolated contexts) + lead live testing. **Nothing in this plan is implemented yet — awaiting approval.** The one sanctioned exception (WAVE-0 CI fix to make the test env functional) was **not** applied because local testing uses native processes, not Docker, so it was not required; the exact patch is specified below for approval.

Severity: P0 catastrophic · P1 serious · P2 meaningful · P3 polish · P4 future.
Owner disciplines: SRE, BE (backend/domain), FE (web), DBE (database), SEC (security), PM (product), UX.

---

## Implementation status (dev branch `claude/new-session-2rsnjm`)

- **WAVE 0 — DONE.** Single MinIO image source of truth (CORS-capable quay pin
  + `${MINIO_IMAGE}`/`${MINIO_MC_IMAGE}` across CI and all compose files; legacy
  no-AVX override documented). CI green end-to-end (all five jobs, incl. the two
  MinIO/S3 browser journeys).
- **WAVE 1 — DONE (approved, implemented + tested).** W1-1 URL scheme allowlist
  (SEC-01); W1-2 `next/image` remotePatterns allowlist (SEC-02); W1-3 access
  token bound to live session + active user + current role (SEC-03); W1-4
  owner-or-admin delete gate for files/notes (SEC-04 groundwork); W1-5 reports
  never sum across currencies (label MIXED + suppress cross-currency grand
  totals, DB-03); W1-6 relationship stats derive from committed participations,
  not invitations (DB-10); W1-7 partial-payment field + correct paid/unpaid
  split (finance P1). Each item ships CI-gated tests. No deploy performed;
  STAGING_ACCEPTANCE remains NOT EXECUTED.
- **WAVE 2 — DONE (approved, implemented + tested).** W2-1 truthful worker
  `/health` (503 when Redis down) + failed/error handlers + dead-letter queue +
  failure metrics; W2-2 exact-size presigned PUT cap + idempotent completion +
  `Attachment.storageKey` unique; W2-3 `Attachment.campaignId` real FK
  (cascade); W2-4 content create wrapped in `$transaction`; W2-5 prod compose
  restart policies + API no longer host-published (internal-only). W2-6
  **partial** — `.dockerignore` hardened to keep tests/docs/CI cruft out of all
  images; the full dev-deps-pruning multi-stage is deferred to a Docker-testable
  pass (no local Docker daemon here; a blind pnpm+prisma+tsx multi-stage risks
  repeated red CI on an image that is not deployed pre-freeze). Each shipped
  item has CI-gated tests. No deploy; STAGING_ACCEPTANCE remains NOT EXECUTED.
- **WAVES 3–8 — not started** (await direction/prioritisation).

---

## WAVE 0 — CURRENT REGRESSIONS / CI  (unblocks everything)

| Item | Owner | Risk | Effort | Deps | Acceptance | Test |
| --- | --- | --- | --- | --- | --- | --- |
| **W0-1 Single MinIO image source of truth** | SRE | Med (CORS nuance) | S | none | CI green; prod/staging start MinIO; browser presigned upload still works | CI runs #build/#e2e/#e2e-s3/#images all green |

**Exact fix (do NOT blind-pin to 2022):**
- The 2022 quay release predates `MINIO_API_CORS_ALLOW_ORIGIN` (needed by `staging.yml:104` and `ci.yml:422` `e2e-s3` for browser uploads). **Pin one 2024 CORS-capable quay release in a single place** (a CI `env: MINIO_IMAGE` + a compose `${MINIO_IMAGE:-…}` default) and reference it everywhere:
  - `.github/workflows/ci.yml:135, 282, 423` — replace `minio/minio server /data` → `${MINIO_IMAGE} server /data`.
  - `docker-compose.full.yml:56` **(this is the file deploy scripts use — the post-freeze fix missed it)** and `:74` (`mc`), `docker-compose.staging.yml:95` & `:116`, `docker-compose.yml:44` → same var/pinned tag.
- Verify the chosen release both (a) pulls anonymously from quay and (b) supports `MINIO_API_CORS_ALLOW_ORIGIN`. If the deploy host genuinely cannot run a post-2022 MinIO (legacy CPU), document the split: prod stays on the 2022 tag behind the same-origin proxy `files` route (no browser CORS needed there) while CI/staging use a 2024 tag — and add a comment at each site explaining why.
- **Also:** the post-freeze commits pinned `docker-compose.yml`, which **no deploy script uses** — align on `docker-compose.full.yml` as the real production file (or delete the divergence).

---

## WAVE 1 — P0 SECURITY / DATA INTEGRITY

There are **no P0s**. This wave = the highest security + integrity items (all P2, two escalation-candidates).

| Item | Owner | Risk | Effort | Deps | Acceptance | Test |
| --- | --- | --- | --- | --- | --- | --- |
| W1-1 URL scheme-allowlist (SEC-01 stored XSS) | SEC/BE | Low | S | none | `javascript:`/`data:` rejected on write for profileUrl/publishedUrl/originalUrl | zod test asserts 422; e2e plants `javascript:` → not stored |
| W1-2 Restrict `next/image` `remotePatterns` (SEC-02 SSRF) | SEC/FE | Low | S | none | only known hosts optimizable; internal URL → 400 | request to `/_next/image?url=<internal>` → 400 |
| W1-3 Bind access token to session/`isActive`/role (SEC-03) | SEC/BE | Med | M | none | logout/revoke/deactivate/demote effective within 1 request | integration: revoke → next call 401 |
| W1-4 Least-privilege groundwork (SEC-04) — record-owner + gate destructive file/note delete behind owner-or-admin | SEC/BE | Med | M | none | non-owner STAFF 403 on delete of others' file/note | scoped-role test |
| W1-5 Mixed-currency summation (DB-03/finance) | DBE/BE | Med | M | none | cross-currency totals either FX-normalized or refused + labelled per currency | test sums KWD+USD → not one KWD number |
| W1-6 Relationship-history inflation on `add()` (DB-10) | BE | Low | S | sourcing model (W3) ideally | `totalCollaborations`/status only advance on confirm/deliver, not invite | test: invite→decline leaves stats unchanged |
| W1-7 Partial-payment field (finance P1) | BE/DBE | Low | S | none | partial payment records a paid amount; not bucketed as fully unpaid | progress test with 1,500 of 3,000 |

*Council note:* SEC-04 stays **P2** under the trusted-staff model; it becomes **P1** the day a limited/freelance operator is onboarded — W1-4 is the minimum groundwork so that transition isn't a rewrite.

---

## WAVE 2 — CORE WORKFLOW DEFECTS (reliability before prod exposure)

| Item | Owner | Risk | Effort | Acceptance | Test |
| --- | --- | --- | --- | --- | --- |
| W2-1 Worker `/health` truthful + `on('failed')`/`on('error')` + DLQ + failure metric (WK-03/04/07) | SRE/BE | Med | M | `/health` 503 when Redis down; failed jobs land in a dead-letter set + alert; stats count failures | kill Redis → health 503; poison job → DLQ+alert |
| W2-2 Presigned PUT size cap (`content-length-range`) + idempotent `complete` (`@unique storageKey`) (WK-01/05) | BE | Low | S | over-size PUT rejected by S3; replayed `complete` → single row | integration replays token |
| W2-3 `Attachment.campaignId` FK + cascade review (DB-04/06) | DBE | Med | S | attachment has real FK; brand delete path can't silently wipe financial history | migration + orphan test |
| W2-4 Wrap multi-step writes in `$transaction` (DB-07) | BE | Low | S | content-create + status + activity + notification atomic | fault-injection test |
| W2-5 Prod compose restart policies + non-direct API port (A6-F4/F5, SEC-06) | SRE | Low | S | postgres/redis/minio/api/worker/web restart on failure; API not host-published | compose config review |
| W2-6 Multi-stage prod images (A6-F6) | SRE | Med | M | images ship no dev deps/source/tests | image size + `node` runtime check |

---

## WAVE 3 — INFLUENCER / UGC MUST-HAVES (the product's biggest gap)

| Item | Owner | Priority | Effort | Acceptance |
| --- | --- | --- | --- | --- |
| W3-1 **Content review/approval + revision rounds** (draft submission, review states, comments, approval history) + a **UGC deliverable type** (asset, no public URL) | PM/BE/FE | P1 | L | a UGC deliverable reaches "approved" without a social URL; approval is auditable; calendar/notifications reflect review stages |
| W3-2 **Usage-rights ledger + license-expiry alerts** (whitelisting/paid/organic, territory, duration, exclusivity, competitor, disclosure, takedown) | PM/BE | P1 | M | staff can answer "what may we use, where, until when"; expiry fires a notification |
| W3-3 **Sourcing / shortlist / candidate pipeline** (staff-facing; fixes DB-10 side-effect) | PM/BE/FE | P2 | M | creators can be considered/shortlisted/rejected before roster commit |
| W3-4 **Bulk roster ops + CSV import + deliverable templates** | FE/BE | P2 | M | build a 100-creator campaign in minutes, not ~500 clicks |
| W3-5 **Product-seeding shipment tracking** | PM/BE/FE | P2 | M | address/courier/tracking/delivered on the gift record |
| W3-6 **Saved views/segments** + **global-search results page** with ranking + notes/tag indexing | FE/BE | P2 | M | filters persist/shareable; search returns a full ranked page |

*Council descope (Engineering ↔ Product):* W3-1 v1 = states + submissions + comments + approval history only; **defer** UGC variants/aspect-ratios/voiceover and the owned-asset library to WAVE 8.

---

## WAVE 4 — SETTINGS / ADMIN OPERABILITY

| Item | Owner | Priority | Effort | Acceptance |
| --- | --- | --- | --- | --- |
| W4-1 User lifecycle (deactivate / change-role / reset-password / remove) | BE/FE | P2 | S | admin can disable a user from the UI; takes effect ≤1 request (needs W1-3) |
| W4-2 Wire **or remove** decorative settings: real `maintenanceMode` gate + banner; make feature flags actually gate; consolidate upload limit on `MAX_UPLOAD_MB`; delete unused `client-config` fields; DB-encrypted integration creds or drop the field | BE/FE/SEC | P2 | M | every shipped control changes behaviour or is removed; no decorative settings remain |
| W4-3 Add `LOGIN_MAX_ATTEMPTS`/`LOGIN_LOCK_MINUTES` (and other security-critical env) to the `env.ts` schema + surface tunables to admin where safe | BE | P2 | S | lockout config validated at boot; documented |
| W4-4 RBAC/ownership model (viewer/limited role + brand scope) — completes W1-4 | BE/FE/SEC | P2 | L | a limited operator sees only assigned brands; least privilege |
| W4-5 Relationship-owner/assignee + reminder routing/escalation | BE/FE | P3 | M | creators/campaigns have an owner; reminders target the owner |

---

## WAVE 5 — UI / UX / DESIGN SYSTEM  (see `DESIGN_SYSTEM_PROPOSAL.md`)

| Item | Owner | Priority | Effort | Acceptance |
| --- | --- | --- | --- | --- |
| W5-1 RTL logical-property pass + lint rule + shared `ui/search-input` (UX-01/03/08) | FE | P2 | M | Arabic layout correct; no physical directional utils in components |
| W5-2 `ui/table.tsx` primitive; migrate 6 tables (UX-02) | FE | P3 | M | one table component; consistent density |
| W5-3 A11y sweep: `aria-current`, Radix tabs, `aria-label` icon buttons, `role=status` (UX-04/05/09/10) | FE | P3 | S | axe clean on key pages; keyboard-navigable tabs |
| W5-4 Perf hygiene: `next/dynamic` recharts, `next/image` imagery (UX-06/07) | FE | P3 | S | chart lazy-loaded; images optimized |
| W5-5 IA cleanup: grouped nav, de-dup notifications, complete quick-add (UX-11/13) | UX/FE | P4 | S | consistent nav + actions |
| W5-6 Cross-browser + responsive + RTL acceptance matrix (Chromium/Firefox/WebKit; desktop/tablet/mobile; light/dark; EN/AR) — the matrix this audit could not run locally | UX/FE | P2 | M | documented pass on the full matrix |

---

## WAVE 6 — ANALYTICS / EXECUTIVE VISIBILITY

| Item | Owner | Priority | Effort | Acceptance |
| --- | --- | --- | --- | --- |
| W6-1 Move CPV/CPM/CPE server-side (fixes ARCH-01) + surface efficiency columns + metric freshness/provenance in reports | BE/FE | P2 | M | no metric math in the browser; reports show efficiency + staleness |
| W6-2 Creator performance leaderboard + tier + repeat-collaboration performance | BE/FE | P2 | M | "strongest/underperformed creators" answerable |
| W6-3 Exec dashboard: today view, cross-brand rollup, since-yesterday digest, **spend-vs-budget KPI** | BE/FE | P2 | M | all 11 exec questions answerable |
| W6-4 Do **not** ship ROI/ROAS/EMV without a revenue/conversion source or a defined methodology (guardrail, not a build) | PM | — | — | no fabricated ROI in the product |

---

## WAVE 7 — PERFORMANCE / SCALE  (see `PERFORMANCE_AUDIT.md`)

| Item | Owner | Priority | Effort | Acceptance |
| --- | --- | --- | --- | --- |
| W7-1 Kill campaign-list N+1 (grouped aggregate) + report N+1 (PERF-01/02) | BE/DBE | P2 | M | campaign list O(1) aggregate queries; report < ~50 queries |
| W7-2 Composite + trigram indexes for directories; cursor pagination for influencer/campaign (PERF-03/04/05) | DBE/BE | P2 | M | `EXPLAIN` = Index Scan; stable cursor paging |
| W7-3 10k-row seed + load/chaos harness (pg/redis down, worker restart, MinIO slow) + Core Web Vitals capture | SRE/DBE | P2 | M | documented behaviour under load + failure; no corruption |

---

## WAVE 8 — FUTURE / OPTIONAL

Rate card / rate history / negotiation log; digest email/Slack notifications; owned-asset library + UGC variants (aspect/language/voiceover/subtitle); in-app outreach/comms log; consent/PII provenance; MFA/2FA; timezone support; entity CSV export/import; nonce/hash CSP; pin GitHub Actions to SHAs + verify gitleaks checksum. **Rejected** (see `PRODUCT_GAP_ANALYSIS.md`): creator portal, discovery marketplace, payout processing, AI matching, custom-field engine, regional-team scoping, e-sign.

---

## AUDIT SCORECARD (0–100, evidence-based, independent — NOT averaged)

| Category | Score | Basis |
| --- | ---: | --- |
| Security | 72 | No P0/P1 externally; solid auth crypto, complete input validation, no secret leak; loses points for SEC-01/02/03/04 + decorative provider-secret storage |
| Architecture | 88 | API-first structurally enforced; one browser-math violation + worker logic outside domain + one god-file |
| Data integrity | 70 | Exact money, sound refresh txn, good unique constraints; loses points for mixed-currency sum, no-FK attachment, non-txn multi-step writes, relationship-inflation, cascade breadth |
| API quality | 82 | Complete validation, consistent errors, typed client; loses points for registry drift, zero OpenAPI response schemas, ignored sort params |
| Testing | 78 | 16 API test files incl. money/authz/file-authz/brand-isolation + Playwright DoD + browser S3; loses points for CI red, no failure-path/worker-DLQ tests, no load/chaos |
| Runtime reliability | 74 | App runtime-clean (no console/5xx); loses points for worker health-always-200, no DLQ, void-main |
| Infrastructure | 60 | Strong scripts/backups/staging isolation; loses points for CI red, prod file mismatch, no restart policy, single-stage images, mutable action tags |
| Campaign operations | 62 | Solid roster→deliverable→content→cost→report; missing sourcing/negotiation/contract/review/approval |
| Influencer CRM | 74 | Strong 360/pipeline/notes/provenance; missing owner, scoring, consent, some fields not editable in UI |
| UGC workflow | 30 | Genuine UGC production not supported (no draft/review/approval/asset/rights) |
| Content monitoring | 80 | Real worker sync + statuses + provenance; YouTube/X only auto, freshness unsurfaced |
| Analytics | 55 | Reports + CSV + efficiency helpers; no ROI source, no leaderboard/benchmark, efficiency unsurfaced |
| Admin / settings | 58 | Real user/session/audit/integration-toggle; large decorative surface + missing user-lifecycle/maintenance/backup controls |
| UX | 74 | Clean, consistent, good empty/loading states; IA + search + RTL execution gaps |
| Visual design | 78 | Real token system, one component + icon family, light/dark parity |
| Accessibility | 66 | Radix baseline + text-not-colour status; gaps in aria-current/labels/live-regions/hand-rolled tabs |
| Responsive / RTL | 62 | RTL wired but physical-property bugs; full responsive matrix unverified |
| Performance | 60 | Fine at current scale; N+1 + seq scans + no code-splitting are real scale risks |
| Mobile readiness | 80 | API-first holds; one browser-math surface + 3 registry routes without a client method |
| Operational readiness | 55 | Backups/DR/observability prepared; CI red + prod-compose gaps + no worker DLQ/alerting block "ready" |

## FINAL CONSOLIDATION COUNCIL (cross-discipline challenges + resolutions)
- **SRE ↔ (prior) freeze:** "CI was green at `410c587`." → The three infra commits regressed it; freeze verification does **not** cover HEAD. Re-established from code. **Resolved.**
- **Security ↔ Files/Worker:** is global file read/delete an IDOR (P1) or by-design (non-issue)? → **Resolved:** by-design under the flat trusted-staff model, so **not** a live IDOR; the real gap is the **absence of least-privilege** (SEC-04, P2), with W1-4 as groundwork. Recorded as an explicit, evidence-based resolution rather than an inflated P1.
- **Settings ↔ Runtime (lead):** "theme/locale persistence is decorative/false." → **Live-adjudicated false positive** — the login DB→cookie bridge applies the account preference cross-device. Corrected in `SETTINGS_REALITY_MATRIX.md`. **Resolved.**
- **Product ↔ Engineering complexity:** review/approval workflow is P1 but large → **descoped** v1 (states+submissions+comments) to WAVE 3; variants/asset-library to WAVE 8. **Resolved.**
- **UGC expert ↔ generic influencer assumptions:** "deliverable = public URL" conflates two workflows → WAVE 3 adds a UGC deliverable type. **Resolved.**
- **Security ↔ Product sequencing:** onboarding limited operators (sourcing/shortlist) needs RBAC first → shortlist is staff-only (no RBAC dependency); RBAC (W4-4) precedes any *external/limited* user. **Resolved.**
- **DBE ↔ everyone on money:** money arithmetic is exact (verified) — but summation ignores currency → the defect is **aggregation**, not precision. **Resolved** (W1-5).
- **Unresolved / explicitly documented:** whether SEC-04 is P1 or P2 — **kept P2 under the current model, flagged P1-on-onboarding**. No other material disagreements remained.

## MCP / TOOLING STATUS (honest)
| Tool | State | Used |
| --- | --- | --- |
| Playwright | **Available via project harness (not MCP)** | YES — smoke, DoD, console/network sweep on **Chromium only** (Firefox/WebKit not provisioned) |
| GitHub (MCP) | Connected (intermittently) | Read-only CI run/log inspection via API |
| WebSearch/WebFetch | Available | YES — 2026 market benchmark (B5): iqfluence, Meltwater, CreatorIQ/GRIN/Aspire/Archive references |
| Figma MCP | **NOT CONNECTED** | Design system delivered as code-level tokens instead (see proposal) |
| shadcn MCP | **NOT CONNECTED** | Component recommendations from the existing `ui/` library only |
| Storybook | **NOT PRESENT / NOT REQUIRED** | Recommend only if the WAVE-5 component work grows; not justified for this pass |
| Chrome DevTools MCP | **NOT CONNECTED** | Perf findings from code + `EXPLAIN`; field CWV deferred to WAVE 7 |

## Could-not-test (and why)
Firefox/WebKit (browsers not provisioned); production Docker images/compose (no local Docker daemon — CI `images` job normally covers, currently skipped by WAVE 0); browser S3 over MinIO locally (native MinIO not confirmed up — covered by CI `e2e-s3`, currently skipped); true 10k-row scale + chaos (WAVE 7 harness).
