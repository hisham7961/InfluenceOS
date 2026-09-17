# InfluenceOS — Security Red-Team

**Audit HEAD:** `85b6c852` · **Reviewers:** Agent 02 (AppSec static), Agent 03/04 (Auth/Session + AuthZ), plus lead live probing against the running stack.
**Threat model:** internal ADMIN/STAFF-only tool, no creator portal. "STAFF" = trusted employees of one agency; there is a single flat workspace (no tenant boundary). Severity is judged against *that* model — where a finding would be P1 under multi-tenant assumptions but is bounded by the trusted-staff model, that is stated explicitly.

**Headline:** No P0. No externally-exploitable pre-auth RCE/SQLi/secret-leak. The real risk surface is (a) a **STAFF→ADMIN privilege-escalation** class (stored URL XSS + no least-privilege), (b) an **open image-proxy SSRF**, (c) **session-revocation latency**, and (d) the CI/deploy regression (see technical audit). Many commonly-flagged areas were verified **sound** and deliberately not raised (listed at the end) to control false positives.

Counts (security scope): **P0 0 · P1 0 · P2 5 · P3 7 · P4 5.** Two P2 items (SEC-01 XSS, SEC-04 no-least-privilege) are the ones a security lead would escalate toward P1 if the org ever admits a less-trusted operator.

---

## Findings

### SEC-01 · P2 · Stored XSS via unvalidated `javascript:` URLs → STAFF→ADMIN
`profileUrl` / `publishedUrl` are free strings with **no scheme validation** (`requests/index.ts:169,255`; stored `social-account.service.ts:77,129`, `deliverable.service.ts:73,108`) and rendered as `<a href>` (`social-accounts-panel.tsx:273`, `campaigns/[id]/workspace.tsx:686`). Any STAFF can plant `javascript:…`; the production web CSP keeps `script-src 'unsafe-inline' 'unsafe-eval'` (`next.config.mjs`), so if it executes in a victim ADMIN's session it is full account takeover. **Caveat (honest severity):** React 19 neutralizes `javascript:` in `href` by default, which blunts the direct click vector — hence P2 not P1 — but the fields still lack defense-in-depth scheme validation and feed other sinks (new-tab open, embed building, future non-React/mobile consumers). **Fix:** allowlist `http(s):` (and `mailto:` where relevant) at the zod layer on write; add a test planting `javascript:`/`data:` and asserting 422. **Verifies:** `deal-semantics`-style integration test on the URL fields.

### SEC-02 · P2 · Open image-proxy SSRF via `next/image`
`apps/web/next.config.mjs` sets `images.remotePatterns` hostname `'**'`, and the middleware excludes `_next/image`. `GET /_next/image?url=<any https>` is therefore an **unauthenticated open proxy** the Next optimizer will fetch server-side — usable for internal host/port probing from the web tier. **Fix:** restrict `remotePatterns` to the known avatar/CDN/object-store hosts (or `unoptimized` + explicit allowlist). **Verifies:** request `/_next/image?url=http://169.254.169.254/…` returns 400.

### SEC-03 · P2 · Access token not bound to session state (revocation latency)
`authenticate()` (`auth.service.ts:303-315`) validates the stateless JWT signature/expiry only — it never loads the user or checks session revocation, `isActive`, or role. So **logout, `revokeSession`, `changePassword`, deactivation, and role-demotion do not take effect until the access token expires (≤15 min)**; a demoted ADMIN keeps admin, a disabled user keeps access, and `changePassword`'s docstring claim "immediately dead everywhere" is false. **Fix:** check a session/`tokenVersion` or `isActive`+role on each request (cheap cached lookup), or shorten access TTL and bump a per-user token epoch on those events. **Verifies:** revoke a session then assert the access token is rejected within one request.

### SEC-04 · P2 · No least-privilege / tenant scoping — flat global CRUD
Corroborated by Agents 03, 06/07 and **live-confirmed** (STAFF `PATCH /campaigns/:id`=200, `PATCH /influencers/:id`=200): `User` has no brand/membership relation; `brandId` is only a caller-supplied *filter*, never actor-scoped (`campaign.service.ts:82`). Every authenticated STAFF can read/update/**delete** any brand's notes, deliverables, campaigns, influencers, expenses, scripts, and **any uploaded file** (`files.routes.ts:87-126`, `attachment.service.ts:211-248`) by id. This is the **intended flat single-org model** (so it is not a cross-tenant IDOR today), but there is **no mechanism to scope a limited operator** (freelancer, per-brand team), and the blast radius of one compromised STAFF account is the entire dataset. **Fix (product-security):** add an optional record-owner / brand-membership scope + a viewer/limited role; at minimum gate destructive file/note delete behind owner-or-admin. **Verifies:** scoped-role test asserting a limited user is 403 on out-of-scope objects.

### SEC-05 · P3 · Open redirect via login `next` param
`login-form.tsx:11,32` passes the `next` query param unvalidated to `router.replace` — external/protocol-relative targets are honored → post-login phishing. **Fix:** only accept same-origin path-relative `next`.

### SEC-06 · P3 · `X-Forwarded-For` spoofing → rate-limit bypass + forged audit IPs
`app.ts:54` sets `trustProxy: true` and the rate limiter keys on `req.ip`; login logs `req.ip` (`auth.routes.ts:21`) and prod compose publishes `:4000` directly. A client can spoof `X-Forwarded-For` to bypass per-IP limits and forge audit/session IPs. **Fix:** set `trustProxy` to the known proxy hop count/subnet, and never expose the API port directly.

### SEC-07 · P3 · CSV/formula injection in report export
`reportToCsv` (`http.ts:62-73`) escapes only `",\n` and never neutralizes a leading `=+-@`; report cells carry user-controlled names (`report.service.ts:139,214,290`). Opening the CSV in Excel/Sheets executes formulas. **Fix:** prefix risky cells with `'`.

### SEC-08 · P3 · BFF forwards any path (not just `/api/v1`)
`api/bff/[...path]/route.ts:46,53-58` forwards **any** path with the bearer injected, so the browser can reach internal-only `/metrics`, `/api/openapi.json`, `/api/docs`. **Fix:** allowlist the BFF to `api/v1/*` only.

### SEC-09 · P3 · Presigned PUT has no size cap (upload/orphan DoS) — see WK-01.
### SEC-10 · P3 · Uploads trust the client-declared MIME type (no sniffing/AV) — see WK-02.
### SEC-11 · P4 · Provider secrets written plaintext to `IntegrationSetting.config` (the `seal()`/envelope crypto is unused here) — but the field is never read (adapters use env), so it is decorative today; remove or encrypt.
### SEC-12 · P4 · Helmet CSP disabled on the API/Swagger UI (`app.ts:60`); prod web CSP retains `unsafe-inline`/`unsafe-eval` (enables SEC-01). Move toward nonce/hash CSP.
### SEC-13 · P4 · Latent CSRF via the API's `access_token` cookie fallback (`http.ts:21-22`) — unexploited today (nothing sets it; CORS is a fixed allowlist), but remove the cookie-token path or add CSRF protection.

## Dependency & secret posture
`pnpm audit --prod` = **0 critical / 0 high / 3 moderate / 1 low**; the residuals (next-intl routing/precompile — unused here; uuid `buf`-only path; `@smithy/config-resolver` low) are not reachable in this app. gitleaks runs blocking in CI; no committed secrets (`.env` gitignored, compose uses `${VAR:?}`); `passwordHash` never serialized.

## Verified SOUND (deliberately NOT raised — false-positive control)
Refresh rotation = lock + jti + 30s grace + correct AES-256-GCM (no reuse/fixation; a new `DeviceSession` per login); no hardcoded/committed secrets; no raw/unsafe SQL, `exec`, `eval`, or `dangerouslySetInnerHTML`; embeds are origin-allowlisted; provider-adapter & content-refresh SSRF is blocked by a platform-hostname allowlist; `SameSite=lax` + `httpOnly` cookies; error contract leaks no stacks/DB detail; admin settings (users/integration-secrets/flags/storage/audit/brand-CRUD) are double-gated route+service; integration config is never returned to clients; HS256 symmetric key = no alg-confusion; input validation is complete across all 95 routes. Cross-object/file access by STAFF was evaluated and classed **by-design (flat model)**, not IDOR, to avoid inflating severity.

## Severity ledger (security)
| Sev | Count | IDs |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 0 | — (SEC-01, SEC-04 are escalation candidates if the trust model loosens) |
| P2 | 5 | SEC-01, SEC-02, SEC-03, SEC-04, (SEC-09/WK-01, SEC-10/WK-02 counted in technical) |
| P3 | 7 | SEC-05, SEC-06, SEC-07, SEC-08, + WK/DB items |
| P4 | 5 | SEC-11, SEC-12, SEC-13, CSP items |
