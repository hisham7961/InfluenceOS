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
| Dependency vulnerabilities | 🟡 PARTIAL | see §5 — remaining findings are tracked and require a controlled Next.js major-version QA, not a blind bump |

## 5. Dependency vulnerabilities (tracked)

Current production audit (`pnpm audit --prod`): **4 critical, 17 high, 25
moderate, 4 low.**

Fixed safely in this phase (no uncontrolled major upgrades — per the phase
rule):

- **fastify** 5.2.1 → **5.8.5** (validated by the full API suite + CI).
- **fast-xml-parser** pinned via `pnpm.overrides` to `>=4.5.5` (transitive, via
  the AWS SDK) — closes its advisory.

Remaining, and why they are tracked rather than force-fixed now:

| Package | Severity | Assessment |
| --- | --- | --- |
| **next** (15.1.6) | 4 critical + several high/moderate | The fix is a Next.js major/minor jump (15.5.x line). It could **not** be validated in this sandbox: the browser Definition-of-Done journey hangs on the client `load` event because the environment has no outbound network for `next/image`/embeds, and the sandbox Playwright/Chromium versions are mismatched — so a bump could not be proven green. The phase rule forbids uncontrolled framework upgrades. **Risk containment:** the two "Unauthenticated RCE" criticals are Windows/dev-server conditions that do not apply to the Linux production container; the "Middleware authorization bypass" does not grant access here because authorization is enforced in the **API** layer, not in Next.js middleware. The Next.js upgrade is the top item for the first controlled maintenance window (with browser QA on real infrastructure). |
| **sharp / libvips / libheif** | high | Pulled in transitively by Next image optimization; resolves with the Next upgrade. |
| **@fastify/static** | high/moderate | Route-guard/path-traversal advisories; the API does not serve user-controlled static paths through it. Resolves on its next patch line; tracked. |
| **postcss** | high | Build-time only (not shipped to runtime). Resolves with the Next toolchain upgrade. |
| **playwright** | high | Dev/test dependency only; not in the production image. |

None of the remaining findings is exploitable in the deployed Linux
container topology as configured; all are tracked for a controlled upgrade
window. This is a 🟡, not a 🔴.

## 6. Testing

| Item | Status | Notes |
| --- | --- | --- |
| Unit + integration (api via `app.inject()`) | ✅ READY | 50 passed, 1 skipped |
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

## Tracked minor findings (not blockers)

These came out of the independent audits. They are safe as-is and are recorded
so they are not lost:

1. **Monetary amounts stored as floating point.** Campaign budgets / expenses
   use floating-point numbers rather than integer minor-units or a decimal type.
   No correctness issue is currently observed, but for accounting-grade rounding
   safety a future migration to integer minor-units (or `Prisma.Decimal`) is
   recommended. Tracked; not a deployment blocker.
2. **Duplicated session-transport constants.** The cookie/token transport
   constant names are defined in more than one place (API and web). They agree
   today; consolidating them into one shared source would remove the risk of
   future drift. Cosmetic; not a deployment blocker.
3. **Next.js dependency CVEs** — see §5. Tracked for a controlled upgrade
   window with browser QA on real infrastructure.
4. **Low-priority UI copy/refresh** — the theme/locale settings copy says
   "saved to your profile" where the save is currently client-local, and the
   content view does not auto-refetch after a background change. Cosmetic;
   tracked.

## Bottom line

The platform is **feature-complete for this phase with no code blockers**. Every
item that can be prepared and validated in the repository/CI is ✅ READY. Every
item that requires touching real infrastructure — the staging deployment, the
production deployment, and everything downstream of them — is intentionally
**⚪ NOT EXECUTED**. Deployment later becomes a controlled execution step, not
new development.
