# Production Readiness

This document is the single source of truth for how ready InfluenceOS is to run
as a real internal company platform. Each capability has a **status** and an
**actual verification method** — a status of ✅ means there is a concrete way to
prove it (a test, a script that was run, a config that exists and was checked),
not merely an intention.

Status legend:

- ✅ **VERIFIED** — implemented and proven by a named method (test / script run / CI job / manual check).
- 🟡 **PARTIAL** — implemented but with a documented limitation or a manual step remaining.
- ⚪ **NOT REQUIRED** — intentionally out of scope for this internal platform.
- 🔴 **BLOCKER** — must be resolved before a production deploy.

Scope guardrails (unchanged): ADMIN/STAFF only, no influencer-facing portals, no
AI features, API-first (business logic only in `@influenceos/domain`).

---

## Readiness matrix

### Configuration & release

| Capability | Status | Verification |
| --- | --- | --- |
| Environment contract with fail-fast | ✅ VERIFIED | `apps/api/src/env.ts` validates at boot and `process.exit(1)` on missing/invalid mandatory vars; production requires a strong non-default `AUTH_SECRET` and complete S3 config. Test: `apps/api/test/integration/ops.test.ts` ("rejects a production env with a weak/default AUTH_SECRET"). CI `images` job also proves the built API image fails fast. |
| `.env` templates | ✅ VERIFIED | `.env.example` (dev) and `.env.production.example` (prod) enumerate every var with guidance. |
| Release identity (version / SHA / build time) | ✅ VERIFIED | `apps/api/src/release.ts`; surfaced on `/health`, in `/metrics` (`influenceos_build_info`), and Settings → Platform. Injected by `scripts/deploy-production.sh`. |
| Immutable-revision releases + rollback | ✅ VERIFIED | `scripts/deploy-production.sh <sha>` / `scripts/rollback-production.sh <sha>`; documented in `docs/GITHUB_RELEASE_WORKFLOW.md`. |

### Runtime & reliability

| Capability | Status | Verification |
| --- | --- | --- |
| Liveness `/health` | ✅ VERIFIED | Returns release identity + uptime; test in `ops.test.ts`; exercised live. |
| Readiness `/ready` (DB probe) | ✅ VERIFIED | 200 ready / 503 not-ready from a real DB check; test in `ops.test.ts`. |
| Graceful shutdown (API) | ✅ VERIFIED | SIGTERM drains via Fastify close + Prisma disconnect + hard-timeout; verified live (`Shutting down API` → `API shutdown complete`, clean exit). |
| Graceful shutdown (worker) | ✅ VERIFIED | SIGTERM drains active BullMQ jobs (`Worker.close`), closes queues/Redis, disconnects Prisma; `apps/worker/src/index.ts`. |
| Worker reliability (retry/backoff/limits) | ✅ VERIFIED | BullMQ attempts:3 + exponential backoff + concurrency/rate limits; inline fallback when Redis is down. CI `e2e` job asserts `mode=redis+bullmq` + a completed sweep. |
| Boot-time DB connectivity check | ✅ VERIFIED | API `prisma.$connect()` fails fast at boot if the DB is unreachable. |

### Security

| Capability | Status | Verification |
| --- | --- | --- |
| Password hashing (Argon2) | ✅ VERIFIED | `@node-rs/argon2`; `docs/SECURITY.md` §1. |
| Rotating refresh tokens (atomic, reuse detection, family revoke) | ✅ VERIFIED | `auth.service.ts` row-locked rotation; `apps/api/test/integration/auth.test.ts` (concurrency, reuse, family revoke, stress). |
| Account-level login lockout | ✅ VERIFIED | Time-boxed lockout (`LOGIN_MAX_ATTEMPTS`/`LOGIN_LOCK_MINUTES`); test in `auth.test.ts` ("account lockout"). |
| Rate limiting (configurable, Redis option) | ✅ VERIFIED | `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`/`RATE_LIMIT_REDIS`; `/health`,`/ready`,`/metrics` allow-listed. |
| Secure cookies + BFF token transport | ✅ VERIFIED | httpOnly + sameSite=lax + secure-in-prod; browser never holds tokens. `docs/SECURITY.md` §2. |
| Security headers + HSTS + CSP | ✅ VERIFIED | `apps/web/next.config.mjs` (HSTS prod-only; CSP drops dev-only sources in prod) + reverse-proxy headers. |
| Error sanitization + request-id correlation | ✅ VERIFIED | No stack/DB leakage; `x-request-id` on every response + error body; test in `ops.test.ts`. |
| Structured logging with secret redaction | ✅ VERIFIED | pino with redacted auth/cookie/api-key headers; one access line per request. |
| Provider secret management | ✅ VERIFIED | Server-only; AES-GCM envelope encryption; not present in the client bundle (checked against `.next/static`). |
| Secret scanning in CI | ✅ VERIFIED | `security` CI job runs gitleaks (blocking) with an allowlist for placeholders. |
| Repo-wide security review | ✅ VERIFIED | `docs/SECURITY.md` §11 (SQLi, XSS, code-exec, path traversal, authz, SSRF, transport). |
| Dependency / supply-chain audit | 🟡 PARTIAL | `security` CI job runs `pnpm audit` **report-only**; known advisories are transitive through the Next.js/SSR toolchain and unfixable without a framework major bump. Tracked below. |

### Data, storage & recovery

| Capability | Status | Verification |
| --- | --- | --- |
| Migrations via `migrate deploy` (never `db push`, never seed in prod) | ✅ VERIFIED | `pnpm db:deploy`; compose `migrate` one-shot; `docs/DATABASE_OPERATIONS.md`. |
| Backups (retention + off-host) | ✅ VERIFIED | `scripts/backup-db.sh` (daily/weekly/monthly + optional S3); ran locally producing a valid archive. |
| Restore | ✅ VERIFIED | `scripts/restore-db.sh` (destructive, `--yes` guarded). |
| Restore drill | ✅ VERIFIED | `scripts/restore-test.sh` ran locally: 29 tables + User rows round-tripped into a scratch DB and matched. `docs/BACKUP_AND_RESTORE.md`. |
| Object storage durability | 🟡 PARTIAL | Private buckets + presigned URLs + two-phase uploads are verified (CI MinIO round-trip + browser `e2e-s3`). Operator MUST provide a durable, backed-up store (managed S3, or MinIO with erasure coding/replication) — DB backups do NOT cover object storage. `docs/OBJECT_STORAGE.md`. |
| Redis / queues | ✅ VERIFIED | `docs/REDIS_AND_QUEUES.md`; appendonly persistence in compose; inline fallback + rate-limit skipOnError degrade safely. |
| Disaster recovery procedure | ✅ VERIFIED | `docs/DISASTER_RECOVERY.md` (DB loss, host loss, bad release, storage loss) with RTO/RPO. |

### Deployment & operations

| Capability | Status | Verification |
| --- | --- | --- |
| Reverse proxy + TLS (only 80/443 public) | ✅ VERIFIED (config) | `deploy/caddy/Caddyfile` (auto-TLS) and `deploy/nginx/influenceos.conf`; `/metrics` never exposed. Config present; requires a real domain to exercise TLS. |
| Production compose with required secrets | ✅ VERIFIED | `docker-compose.full.yml` (`${VAR:?}` for every secret; migrate one-shot; healthchecks). |
| Container images build | ✅ VERIFIED | CI `images` job builds api/worker/web and smoke-tests the API image's env fail-fast. |
| Deploy / rollback / smoke scripts | ✅ VERIFIED | `scripts/deploy-production.sh`, `rollback-production.sh`, `smoke-test.sh` (syntax-checked; smoke assertions exercised against a live API). |
| Zero/low-downtime guidance | ✅ VERIFIED | Expand/contract migrations + health-gated rollout + multi-instance/Redis limiter; `docs/GITHUB_RELEASE_WORKFLOW.md`. Single-host restart window documented honestly. |
| Staging environment | ✅ VERIFIED (procedure) | Same compose + `APP_ENV=staging` + separate secrets/domain; `docs/GITHUB_RELEASE_WORKFLOW.md`. Procedure documented; stand-up is an operator action. |
| Operations runbook + checklist | ✅ VERIFIED | `docs/OPERATIONS_RUNBOOK.md`, `docs/PRODUCTION_CHECKLIST.md`. |
| Production architecture doc | ✅ VERIFIED | `docs/PRODUCTION_ARCHITECTURE.md` (Mermaid topology, trust boundary, ports). |

### Observability

| Capability | Status | Verification |
| --- | --- | --- |
| Metrics (`/metrics`, internal-only) | ✅ VERIFIED | Prometheus exposition (build info, up, db_up, process, http_requests_total by route template + status class); test in `ops.test.ts`; rendered live. |
| Prometheus + alerts + Grafana | ✅ VERIFIED (config) | `deploy/observability/{prometheus.yml,alerts.yml,grafana-dashboard.json}`; dashboard JSON validated. Wiring Alertmanager is an operator action. |
| Admin monitoring surface | ✅ VERIFIED | Settings → Platform shows versions, git SHA, build time, uptime, component health. |

### Verification pipeline

| Capability | Status | Verification |
| --- | --- | --- |
| CI: secret scan + dependency audit | ✅ VERIFIED | `security` job. |
| CI: typecheck/lint/unit/integration (+MinIO)/contract/DoD/build | ✅ VERIFIED | `build` job. |
| CI: image builds + env fail-fast smoke | ✅ VERIFIED | `images` job. |
| CI: full-stack browser E2E (local driver) | ✅ VERIFIED | `e2e` job (API + worker + web + Playwright smoke & DoD). |
| CI: browser S3 E2E | ✅ VERIFIED | `e2e-s3` job (whole stack on S3/MinIO; browser presigned upload→download→delete). Verified locally before wiring. |

### Explicitly out of scope

| Item | Status | Rationale |
| --- | --- | --- |
| Influencer-facing portal | ⚪ NOT REQUIRED | Internal ADMIN/STAFF platform by design. |
| AI/LLM features | ⚪ NOT REQUIRED | Product constraint. |
| Business logic in Next.js | ⚪ NOT REQUIRED | API-first: logic lives only in `@influenceos/domain`. |
| Deploying to a live server / DNS / cloud resources | ⚪ NOT REQUIRED (this pass) | Not authorized in this pass; the platform is made *deployable*, not deployed. |

---

## Remaining blockers

**None that block a first internal deployment**, provided the operator completes
the environment-owned prerequisites below. There are no 🔴 items in code.

Operator prerequisites before first production deploy (see `docs/PRODUCTION_CHECKLIST.md`):

1. Provide real secrets (strong `AUTH_SECRET` ≥32 chars, DB/Redis/MinIO
   passwords, bootstrap admin) via `.env.production`.
2. Provide a durable, backed-up object store (managed S3 or replicated MinIO).
3. Point the reverse proxy at a real domain and obtain TLS certificates.
4. Schedule `scripts/backup-db.sh` (cron) and a periodic `scripts/restore-test.sh`.
5. Stand up Prometheus/Grafana on the private network and wire Alertmanager.

## Tracked (non-blocking) items

- **Transitive dependency advisories** — report-only in CI; unfixable without a
  Next.js major upgrade. Re-audit on dependency bumps. (`docs/SECURITY.md` §11.)
- **CSP `unsafe-inline`/`unsafe-eval`** — retained for Next.js; nonce/hash
  tightening is a follow-up.

## How this was verified

Every ✅ above maps to one of: a test in the suite (run in CI), a CI job, a
script that was executed and whose output was checked, or a config file whose
validity was checked. The complete pipeline for the release candidate —
`security` + `build` + `images` + `e2e` + `e2e-s3` — runs on every push; the
GitHub Actions run for the release-candidate commit is the authoritative
evidence. Do not treat a green run of an *earlier* commit as evidence for a
later one.

## Related docs

- `docs/PRODUCTION_ARCHITECTURE.md`, `docs/OPERATIONS_RUNBOOK.md`, `docs/PRODUCTION_CHECKLIST.md`
- `docs/DATABASE_OPERATIONS.md`, `docs/BACKUP_AND_RESTORE.md`, `docs/DISASTER_RECOVERY.md`
- `docs/OBJECT_STORAGE.md`, `docs/REDIS_AND_QUEUES.md`, `docs/OBSERVABILITY.md`
- `docs/GITHUB_RELEASE_WORKFLOW.md`, `docs/SECURITY.md`
