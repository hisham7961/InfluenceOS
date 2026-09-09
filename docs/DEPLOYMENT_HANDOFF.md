# Deployment Handoff

The single document to follow when deploying InfluenceOS. Everything here is
prepared and validated in the repository/CI; **no environment has been
deployed**. Values are placeholders — fill them from your infrastructure at
deploy time. Cross-references point to the deeper docs.

> Deploy the EXACT git SHA that passed CI. Config differs between environments;
> code does not. See `docs/GITHUB_RELEASE_WORKFLOW.md`.

---

## A. Infrastructure requirements

| Component | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| Host | 2 vCPU / 4 GB / 40 GB SSD | 4 vCPU / 8 GB / 80 GB SSD | Linux + Docker + Compose v2 |
| PostgreSQL 16 | bundled container or managed | managed w/ backups | source of truth |
| Redis 7 | bundled container | managed / persistent | queues + rate-limit store |
| Object storage | bundled MinIO | managed S3 / replicated MinIO | private buckets, must be backed up |
| Reverse proxy | Caddy (bundled) or Nginx | — | only public entry (80/443) |

Full topology: `docs/PRODUCTION_ARCHITECTURE.md`. Sizing/DNS/firewall detail:
`docs/OPERATIONS_RUNBOOK.md` (Server sizing, DNS & firewall).

## B. Required environment variables

Start from `.env.production.example` (production) or `.env.staging.example`
(staging). The API fails fast at boot on a missing/weak mandatory value
(`apps/api/src/env.ts`). Mandatory: `NODE_ENV=production`, `APP_ENV`,
`DATABASE_URL`, `DIRECT_DATABASE_URL`, `AUTH_SECRET` (≥32 chars, non-default),
`NEXT_PUBLIC_APP_URL`, `WEB_ORIGIN`, `INTERNAL_API_URL`; with `STORAGE_DRIVER=s3`:
`S3_INTERNAL_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`. Compose secrets: `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`,
`MINIO_ROOT_PASSWORD`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`.
Tunables: `REDIS_URL`, `RATE_LIMIT_*`, `LOGIN_MAX_ATTEMPTS`/`LOGIN_LOCK_MINUTES`,
`MAX_UPLOAD_MB`, `APP_VERSION`/`GIT_SHA`/`BUILD_TIME`, `BACKUP_*`.

## C. Server preparation

1. Provision the host; install Docker + Docker Compose v2.
2. Clone the repo; check out the release SHA.
3. `cp .env.production.example .env.production` and fill every placeholder
   (generate secrets on the host; never commit them).
4. `scripts/preflight.sh --env .env.production` → resolve any FAIL.

## D. DNS records

| Record | Type | Target | Purpose |
| --- | --- | --- | --- |
| `<app-host>` | A/AAAA | proxy public IP | the platform |
| `<files-host>` | A/AAAA | proxy public IP | browser object-storage endpoint (self-hosted MinIO only) |

Set `NEXT_PUBLIC_APP_URL`/`WEB_ORIGIN` to `https://<app-host>`. Do not change DNS
as part of a routine redeploy.

## E. TLS

Caddy obtains + renews certificates automatically (`deploy/caddy/Caddyfile`,
`CADDY_ACME_EMAIL`, `SITE_ADDRESS`). With Nginx, issue certs via certbot
(`deploy/nginx/influenceos.conf`). HTTP → HTTPS redirect is automatic.

## F. Storage choice

- **Self-hosted MinIO** (bundled): private bucket, presigned URLs, browser
  reaches it via the proxy's files host. `MINIO_API_CORS_ALLOW_ORIGIN` = web
  origin. `docs/OBJECT_STORAGE.md`.
- **Managed S3**: point `S3_*` at the managed endpoint; enable bucket versioning
  + backups; configure CORS to the web origin.
- Object storage is NOT covered by DB backups — back it up separately.

## G. Database setup

Use a dedicated database (`influenceos_production` / `influenceos_staging`).
Apply schema with `pnpm db:deploy` (`prisma migrate deploy`) — never `db push`,
never the demo seed in production. The compose `migrate` one-shot runs migrations
+ the idempotent admin bootstrap before app services start.
`docs/DATABASE_OPERATIONS.md`.

## H. Redis

Dedicated instance, password-protected, off the public network, append-only
persistence enabled. `docs/REDIS_AND_QUEUES.md`.

## I. Bootstrap admin

The first admin is created only when the DB has no users, from
`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` (idempotent). No hardcoded
password ships; the admin changes it via Settings → Security after first login.

## J. Deployment command

```bash
scripts/deploy-production.sh <git-sha-or-tag>
# staging: scripts/deploy-staging.sh <git-sha-or-tag>
```

The script checks out the SHA, takes a pre-deploy backup, injects release
metadata, builds images, applies migrations, starts services, and gates on
`/health` + `/ready`. `docs/GITHUB_RELEASE_WORKFLOW.md`.

## K. Migration procedure

`prisma migrate deploy` runs forward-only. Prefer additive/backward-compatible
migrations (expand/contract) so old and new code run against the same schema
during rollout. Never a destructive migration in the same release as the code
that needs it. `docs/DATABASE_OPERATIONS.md`, `docs/GITHUB_RELEASE_WORKFLOW.md`.

## L. Backup configuration

Schedule `scripts/backup-db.sh` (cron, e.g. daily 02:30) with an off-host
`BACKUP_S3_*` destination; retention daily/weekly/monthly. Verify with
`scripts/restore-test.sh`. `docs/BACKUP_AND_RESTORE.md`.

## M. Smoke test (post-deploy, non-destructive)

```bash
scripts/smoke-test.sh https://<app-host> https://<app-host>       # production
scripts/smoke-staging.sh https://<staging-host>                    # staging
```

## N. Acceptance test (staging, disposable data)

```bash
BASE_URL=https://<staging-host> STAGING_ADMIN_EMAIL=… STAGING_ADMIN_PASSWORD=… \
  scripts/acceptance-staging.sh
```

Creates + deletes `STAGING-TEST-*` records across the full workflow.
`docs/STAGING.md`, `docs/STAGING_ACCEPTANCE.md`.

## O. Rollback

```bash
scripts/rollback-production.sh <previous-good-sha> [--yes]
```

Redeploys an earlier immutable SHA. The DB is not auto-downgraded — restore a
backup first if a migration is incompatible. `docs/DISASTER_RECOVERY.md`.

## P. Monitoring

Run Prometheus on the private network scraping the API `/metrics`
(`deploy/observability/prometheus.yml`); import `grafana-dashboard.json`; wire
`alerts.yml` to Alertmanager (destinations are placeholders until deploy).
`/metrics` is never publicly exposed. `docs/OBSERVABILITY.md`.

## Q. Production promotion

Promote the exact SHA validated on staging (acceptance passed, backup/restore
proven). `feature branch → CI → staging → acceptance → approved SHA →
production`. Promotion is forbidden while any 🔴 blocker remains in
`docs/STAGING_ACCEPTANCE.md` / `docs/PRE_DEPLOYMENT_STATUS.md`.

---

### First-deploy quick sequence

```bash
# 1. prepare
cp .env.production.example .env.production   # fill every value
scripts/preflight.sh --env .env.production
# 2. deploy the tested SHA
scripts/deploy-production.sh <git-sha>
# 3. verify
scripts/smoke-test.sh https://<app-host> https://<app-host>
# 4. schedule backups + a restore drill (cron)
```
