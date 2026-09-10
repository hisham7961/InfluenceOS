# Pre-Deployment Status

The single honest snapshot of where InfluenceOS stands **before any environment
is deployed**. It answers one question per area: is this ready to be executed
against real infrastructure, and what (if anything) is still open?

Every deployment activity that requires a real server, hostname, DNS, TLS,
secret, or cloud resource is deliberately left **⚪ NOT EXECUTED** — no staging
or production environment has been deployed, by design.

## Status legend

| Symbol | Meaning |
| --- | --- |
| ✅ READY | Built, validated in the repository/CI, nothing left to do before deploy |
| 🟡 PARTIAL | Works and is safe, with a documented, tracked limitation |
| 🔴 BLOCKER | Would prevent a safe deployment — must be fixed first |
| ⚪ NOT EXECUTED | Deliberately not run; requires real infrastructure/credentials at deploy time |

**There are currently no 🔴 blockers in the codebase.**

---

## 1. Product completeness

| Area | Status | Notes |
| --- | --- | --- |
| Brands (CRUD, workspace, edit) | ✅ READY | API + web UI, edit dialog wired |
| Influencers (directory, 360 profile, edit, social accounts) | ✅ READY | profile tabs, edit dialog, social-account panel |
| Campaigns (CRUD, status, roster, deliverables, expenses, scripts) | ✅ READY | full workspace; edit/status/delete all wired |
| PAID **and** FREE collaborations | ✅ READY | FREE (zero-fee) preserved through roster edit — not overwritten to a paid amount |
| Scripts & references (authoring, versions) | ✅ READY | script authoring in the campaign workspace |
| Published content, player, monitoring | ✅ READY | Live Content + What's New |
| Reports & CSV export | ✅ READY | analytics + export |
| Calendar, notifications, activity feed, audit log | ✅ READY | |
| Attachments (two-phase signed upload/download/delete) | ✅ READY | validated over real MinIO S3 in CI |
| Settings → General / Security (sessions) | ✅ READY | general page added; active-session list + revoke / revoke-all |
| No fake buttons / dead links | ✅ READY | UI action audit completed; every rendered action reaches a real API |

Independent audits run for this phase: static security (no high/medium
findings), api-client/DTO boundary (intact), and a full UI action audit (found
real gaps, which were then implemented — see the CHANGELOG "Web workflows"
entry). Two low-severity code-quality findings are tracked in §15 below.

## 2. API

| Item | Status | Notes |
| --- | --- | --- |
| Fastify `/api/v1`, versioned, OpenAPI + Swagger UI | ✅ READY | single source of truth for web + future mobile |
| Zod validation, standardized error contract | ✅ READY | never leaks DB errors/stacks; request-id on every response |
| AuthZ enforced at the API layer (not just hidden UI) | ✅ READY | ADMIN vs STAFF enforced server-side; covered by tests |
| Health / readiness / metrics | ✅ READY | `/health`, `/ready` (DB probe → 503), `/metrics` (internal only) |
| Rate limiting (configurable, optional Redis store) | ✅ READY | probes allow-listed |
| Graceful shutdown (SIGTERM/SIGINT drain) | ✅ READY | api + worker |
| Fastify runtime | ✅ READY | on 5.8.5 (security update from 5.2.1), validated in CI |

## 3. Mobile readiness

| Item | Status | Notes |
| --- | --- | --- |
| API-first contract for future iOS/Android clients | ✅ READY | no business logic in the web tier; BFF is transport only |
| Feature registry / mobile-readiness surface | ✅ READY | `/platform` endpoints, `docs/MOBILE_READINESS.md` |
| Native mobile apps | ⚪ NOT EXECUTED | out of scope for this phase; the API is ready to serve them when built |

## 4. Security

| Item | Status | Notes |
| --- | --- | --- |
| Argon2 password hashing | ✅ READY | |
| Rotating refresh tokens (atomic rotation), account lockout | ✅ READY | `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` |
| BFF token transport (httpOnly cookies, no tokens in JS storage) | ✅ READY | |
| AES-GCM envelope encryption for integration secrets | ✅ READY | |
| Private object storage, presigned URLs, signed-download tickets | ✅ READY | unsigned GET denied |
| Security headers / CSP (HSTS in prod, object-store origin allow-listed) | ✅ READY | |
| Secret scanning (gitleaks) in CI | ✅ READY | real `.env.*` files git-ignored; only `*.example` tracked |
| Static security audit (secrets, sinks, SQL, CORS, redaction, token storage) | ✅ READY | no high/medium findings |
| Dependency vulnerabilities | ✅ READY | 0 applicable critical, 0 applicable high — see §5. Only 3 moderate + 1 low remain, each classified as not reachable in this app/topology. |

## 5. Dependency vulnerabilities

Current production audit (`pnpm audit --prod`): **0 critical, 0 high, 3
moderate, 1 low** (was 4 critical / 17 high / 25 moderate / 4 low at the start of
the freeze pass).

Fixed in the controlled freeze upgrade (smallest safe path; no blind major jump):

- **next** 15.1.6 → **15.5.25** (maintained 15.x line) — clears all 4 Next.js
  criticals and the Next-toolchain highs (sharp/libvips, DoS/SSRF). Validated:
  typecheck, lint, production build, API suite, Playwright smoke, and the full
  browser DoD journey.
- **@fastify/swagger-ui** 5.2.2 → **6.1.1** → pulls **@fastify/static 10.1.3**,
  clearing its route-guard/path-traversal advisories.
- **fastify** 5.8.5 → **5.12.3** — clears the schema-coercion and X-Forwarded
  (trustProxy) moderates.
- **postcss** → **8.5.28** (+ override) — clears the source-map path-traversal
  highs (build-time tool).
- **@playwright/test** 1.49.1 → **1.56.1** — clears the browser-integrity high
  (dev/test only).
- Retained: **fast-xml-parser** `>=4.5.5` override.

Remaining, each verified **not reachable** in this application/topology (fix
needs a major bump with no applicable code path — tracked, not blocking):

| Package | Severity | Assessment |
| --- | --- | --- |
| **next-intl** (3.26.x) | moderate ×2 | Open-redirect lives in next-intl's routing/navigation middleware and prototype-pollution in `experimental.messages.precompile`. We use **only** `next-intl/server` (`getLocale`/`getMessages`/`getRequestConfig`) — no next-intl routing/middleware and not that experimental option — so neither code path exists here. Fix requires next-intl 4.x (breaking i18n); scheduled for a controlled i18n upgrade. |
| **uuid** (9.0.1) | moderate | Transitive; the advisory triggers only when a caller passes a `buf` argument to v3/v5/v6, which our dependents do not (we use `node:crypto` `randomUUID`). Fix needs a major override. |
| **@smithy/config-resolver** | low | AWS SDK "defense-in-depth enhancement", not an exploitable defect; resolves on the next AWS SDK bump. |

This is a ✅ for the freeze target (0 applicable critical, 0 applicable high);
the residual moderates/low are documented, not silently accepted.

## 6. Testing

| Item | Status | Notes |
| --- | --- | --- |
| Unit + integration (api via `app.inject()`) | ✅ READY | 63 passed, 1 skipped |
| Money precision (exact Decimal; 0.1+0.2, multi-line totals, deal semantics) | ✅ READY | domain `money.test.ts` + api `money-precision.test.ts` / `deal-semantics.test.ts` |
| Account preference persistence + shared transport constants | ✅ READY | `preferences.test.ts`, `transport.test.ts` |
| Access-control tests (ADMIN vs STAFF, mutating ops → 403) | ✅ READY | `authz.test.ts` |
| Brand-isolation tests (scoped queries don't leak across brands) | ✅ READY | `brand-isolation.test.ts` |
| File-authorization tests (cross-file / tampered / missing / expired ticket) | ✅ READY | `file-authz.test.ts` |
| Abandoned-upload cleanup test | ✅ READY | `upload-cleanup.test.ts` |
| Contract test (routes exist / OpenAPI) | ✅ READY | |
| Browser E2E (local driver) + browser S3 E2E (real MinIO) | ✅ READY | CI `e2e` + `e2e-s3` jobs |
| Staging acceptance / DR drill against a real host | ⚪ NOT EXECUTED | mechanisms validated locally; real run needs the staging host — `docs/STAGING_ACCEPTANCE.md` |

## 7. Object storage

| Item | Status | Notes |
| --- | --- | --- |
| S3 / MinIO / local-disk drivers | ✅ READY | `StorageDriver` incl. `list()` |
| Two-phase signed uploads (initiate → PUT → complete) | ✅ READY | |
| Private buckets, presigned URLs, CORS to web origin | ✅ READY | validated in `e2e-s3` |
| Abandoned-upload cleanup (24h grace) | ✅ READY | worker maintenance sweep |
| Real managed-S3 bucket + credentials | ⚪ NOT EXECUTED | provided at deploy time |

## 8. Worker

| Item | Status | Notes |
| --- | --- | --- |
| BullMQ + ioredis worker, boot DB check, `/health` | ✅ READY | |
| Maintenance sweep (hourly) incl. abandoned-upload cleanup | ✅ READY | reports `abandonedUploadsCleaned` |
| Job idempotency | ✅ READY | cleanup keyed on grace window + missing `Attachment` row |
| Graceful shutdown | ✅ READY | |

## 9. Database

| Item | Status | Notes |
| --- | --- | --- |
| Prisma 6 + PostgreSQL 16, forward-only migrations | ✅ READY | expand/contract discipline documented |
| Idempotent admin bootstrap (only when no users exist) | ✅ READY | no hardcoded password ships |
| `db:deploy` (`migrate deploy`), never `db push` / demo seed in prod | ✅ READY | `docs/DATABASE_OPERATIONS.md` |
| Real production/staging database | ⚪ NOT EXECUTED | dedicated DB provisioned at deploy time |

## 10. Redis

| Item | Status | Notes |
| --- | --- | --- |
| ioredis client, queue + optional rate-limit store | ✅ READY | `docs/REDIS_AND_QUEUES.md` |
| Real password-protected, persistent instance | ⚪ NOT EXECUTED | provisioned at deploy time |

## 11. Backups

| Item | Status | Notes |
| --- | --- | --- |
| `backup-db.sh` / `restore-db.sh` / `restore-test.sh` | ✅ READY | off-host destination, retention tiers |
| DR drill script (`dr-drill-staging.sh`) | ✅ READY | validated locally: schema + records match |
| Scheduled backups + restore drill on a real host | ⚪ NOT EXECUTED | cron scheduled at deploy time |

## 12. Monitoring prep

| Item | Status | Notes |
| --- | --- | --- |
| Prometheus config, alert rules, Grafana dashboard | ✅ READY | `deploy/observability/*` |
| API `/metrics` (internal only, low cardinality) | ✅ READY | never publicly exposed |
| Live scraping + alert destinations | ⚪ NOT EXECUTED | Alertmanager destinations are placeholders until deploy |

## 13. Deployment prep

| Item | Status | Notes |
| --- | --- | --- |
| `preflight.sh` (non-destructive readiness report) | ✅ READY | env, docker/compose, disk, memory, ports, DNS, connectivity |
| Deploy / rollback scripts (prod + staging) | ✅ READY | deploy the exact tested SHA |
| Docker images run as non-root (`node` user) + `.dockerignore` | ✅ READY | api / web / worker |
| Compose validation (`docker compose config`) in CI | ✅ READY | all three compose files |
| Reverse-proxy configs (Caddy + Nginx) | ✅ READY | only public entry (80/443) |
| `docs/DEPLOYMENT_HANDOFF.md` (single deploy runbook) | ✅ READY | placeholders filled at deploy time |
| Actual deployment | ⚪ NOT EXECUTED | see §14 / §15 |

## 14. Staging prep

| Item | Status | Notes |
| --- | --- | --- |
| `.env.staging.example`, `docker-compose.staging.yml`, `Caddyfile.staging` | ✅ READY | complete isolation from production (host/DB/Redis/bucket/creds/admin) |
| `deploy-staging.sh` guard rails (APP_ENV / DB / bucket must be "staging") | ✅ READY | verified to refuse non-staging targets |
| `smoke-staging.sh`, `acceptance-staging.sh`, `dr-drill-staging.sh` | ✅ READY | acceptance + DR drill validated locally end-to-end |
| **Staging deployment** | ⚪ **NOT EXECUTED** | requires real staging host, hostname, DNS, TLS, secrets |

## 15. Production prep

| Item | Status | Notes |
| --- | --- | --- |
| `.env.production.example`, production compose, proxy, deploy/rollback | ✅ READY | |
| Promotion workflow (feature → CI → staging → acceptance → approved SHA → prod) | ✅ READY | `docs/GITHUB_RELEASE_WORKFLOW.md`, handoff §Q |
| **Production deployment** | ⚪ **NOT EXECUTED** | forbidden until staging acceptance passes on real infrastructure |

---

## Previously-tracked minor findings — now resolved in the freeze pass

The audit findings that were open at pre-deployment have been closed:

1. **Monetary amounts as floating point** → **RESOLVED.** All money is exact
   `Prisma.Decimal` arithmetic converted once to a scale-3 `number` DTO; storage
   widened to `Decimal(18,3)` for KWD fils. Unit + end-to-end precision tests.
2. **Duplicated session-transport constants** → **RESOLVED.** Consolidated into
   `@influenceos/contracts/transport`, imported by web BFF, edge middleware, and
   API; pinned by a contract test.
3. **Next.js dependency CVEs** → **RESOLVED** (0 applicable critical / 0
   applicable high). See §5 for the controlled upgrade and the residual, non-
   reachable moderates/low.
4. **Theme/locale copy + background refresh** → **RESOLVED.** Preferences are
   persisted on the account (truthful copy); refresh-on-focus + a Live Content
   interval + a throttled Mission Control refresh were added.

No open minor findings remain. No 🔴 blockers.

## Bottom line

The platform is **feature-complete for this phase with no code blockers**. Every
item that can be prepared and validated in the repository/CI is ✅ READY. Every
item that requires touching real infrastructure — the staging deployment, the
production deployment, and everything downstream of them — is intentionally
**⚪ NOT EXECUTED**. Deployment later becomes a controlled execution step, not
new development.
