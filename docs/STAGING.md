# Staging Environment

Staging is a **complete, isolated mirror of production** used to validate a
release candidate before it is promoted to production. It runs the SAME
architecture and the SAME production builds — only its configuration, data, and
secrets differ.

```
Internet → Caddy (80/443, TLS) → Web (SSR + BFF) → API → PostgreSQL
                                                     ├→ Redis → Worker
                                                     └→ Private S3/MinIO
```

**Staging shares NOTHING with production.** Separate hostname, database, Redis,
object-storage bucket, credentials, secrets, bootstrap admin, and (where
applicable) social-provider credentials. Staging must **never** be pointed at
the production database, bucket, or secrets.

Related: `docs/PRODUCTION_ARCHITECTURE.md`, `docs/GITHUB_RELEASE_WORKFLOW.md`,
`docs/BACKUP_AND_RESTORE.md`, `docs/OBSERVABILITY.md`, `docs/STAGING_ACCEPTANCE.md`.

---

## 1. What makes staging separate

| Concern | Production | Staging |
| --- | --- | --- |
| Hostname | `influenceos.example.com` | `staging.influenceos.example.com` |
| Files host | e.g. managed S3 / `files.…` | `staging-files.influenceos.example.com` |
| Database | `influenceos_production` | `influenceos_staging` |
| Object bucket | production bucket | `influenceos-staging` |
| Redis | production instance | dedicated staging instance |
| Secrets | production values | staging-only values |
| Admin | production admin | `staging-admin@…` (separate) |
| Build mode | `NODE_ENV=production` | `NODE_ENV=production` (same) |
| Env label | `APP_ENV=production` | `APP_ENV=staging` |

Staging runs **production builds** (`NODE_ENV=production`) — never Next.js dev
mode — so it exercises the exact code path that ships.

## 2. Files in this repo

| File | Purpose |
| --- | --- |
| `.env.staging.example` | Documented staging env template — copy to `.env.staging`, fill in, never commit. |
| `docker-compose.staging.yml` | Self-contained staging stack; only the Caddy proxy is public. |
| `deploy/caddy/Caddyfile.staging` | Staging reverse proxy: main host (web/API) + files host (private MinIO). |
| `scripts/deploy-staging.sh` | Guarded 16-step staging deploy. |
| `scripts/smoke-staging.sh` | Non-destructive HTTPS smoke test. |
| `scripts/acceptance-staging.sh` | Functional acceptance (creates + deletes `STAGING-TEST-*` records). |
| `scripts/dr-drill-staging.sh` | Backup → temp restore → verify drill (staging-guarded). |
| `docs/STAGING_ACCEPTANCE.md` | The sign-off report to fill in at deploy time. |

The staging compose is intentionally **not** a Compose override of
`docker-compose.full.yml`: Compose merges `ports` additively, so an override
cannot un-publish the base file's host ports (they would leak to the host). A
dedicated file keeps the "only the proxy is public" guarantee unambiguous while
still reusing the same Dockerfiles and the same `migrate` one-shot.

## 3. Secret checklist (generate real values — NEVER in Git)

Prepare these before deploying. Generate them on the staging host / in your
secret manager and place them in `.env.staging` (kept out of Git):

- [ ] `AUTH_SECRET` — staging-only, ≥32 chars: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- [ ] `POSTGRES_PASSWORD` — staging DB password
- [ ] `MINIO_ROOT_USER` / object-store access key (staging)
- [ ] `MINIO_ROOT_PASSWORD` / object-store secret key (staging)
- [ ] `BOOTSTRAP_ADMIN_EMAIL` — first staging admin address
- [ ] `BOOTSTRAP_ADMIN_PASSWORD` — staging-only initial admin password (changed on first login)
- [ ] (optional) `BACKUP_S3_*` — off-host staging backup destination
- [ ] (optional) staging/sandbox social-provider credentials — never production tokens

Secrets are **never printed** into deploy logs (the deploy script masks DB URLs
and never echoes secret values). `AUTH_SECRET`, cookies, and provider secrets are
never sent to the browser.

## 4. First staging deploy

Prerequisites: a Linux host with Docker + Docker Compose v2, DNS for the staging
host(s) pointing at it, and ports 80/443 open (see the firewall table in
`docs/OPERATIONS_RUNBOOK.md`).

```bash
# On the staging host, in the repo:
cp .env.staging.example .env.staging
#   … edit .env.staging: real hostname + all secrets (section 3) …

# Deploy the EXACT release-candidate SHA (the one that passed CI):
scripts/deploy-staging.sh <git-sha-or-tag>
```

`deploy-staging.sh` refuses to run unless `APP_ENV=staging`, the database name
contains `staging`, and the bucket name contains `staging` — hard rails against
ever touching production. It then: records the SHA, takes a pre-deploy backup
(if a staging DB already exists), builds images, runs `prisma migrate deploy`
(**never** `db push`, **never** the demo seed) and the idempotent admin
bootstrap via the compose `migrate` one-shot, starts services, waits for
`/ready`, runs the smoke test, and reports the deployed build.

Manual equivalent (the script is preferred):

```bash
docker compose -p influenceos-staging --env-file .env.staging \
  -f docker-compose.staging.yml up -d --build
```

## 5. Object storage on staging

Two supported topologies:

- **Self-hosted MinIO (bundled).** The compose runs a private MinIO; the browser
  reaches presigned URLs via the proxy's files host (`FILES_ADDRESS` →
  `minio:9000`, Host-preserving so SigV4 validates). MinIO keeps objects
  private; `MINIO_API_CORS_ALLOW_ORIGIN` is set to the staging web origin so the
  browser's cross-origin presigned PUT is allowed. Verify the round trip
  (browser → presigned PUT → complete → presigned GET → delete) with
  `scripts/acceptance-staging.sh`.
- **Managed S3.** Point `S3_INTERNAL_ENDPOINT`/`S3_PUBLIC_ENDPOINT` at the
  managed endpoint, drop the MinIO service and the files site block from the
  Caddyfile, and configure the bucket's CORS to allow the staging web origin.

Either way the bucket is **private** — the smoke test asserts an unsigned GET is
denied (403/404), never 200.

## 6. Redis / queues on staging

Staging uses its own Redis (own container + volume, own append-only file), so
queue state is never shared with production. The worker runs the three BullMQ
queues with a brisk `MONITOR_CRON` (default `*/5 * * * *`) so behaviour is easy
to observe. Verify worker health inside the stack:

```bash
docker compose -p influenceos-staging -f docker-compose.staging.yml exec worker \
  node -e "fetch('http://localhost:4100/health').then(r=>r.json()).then(j=>console.log(j))"
# expect: mode "redis+bullmq", a recent lastMaintenanceAt
```

If Redis is unreachable the worker falls back to an inline loop (`mode:
inline-fallback`) — acceptable but noted; a healthy staging should report
`redis+bullmq`.

## 7. Backups, restore, and the DR drill (prove BEFORE production)

Backup/restore MUST be proven on staging before production promotion.

```bash
# Backup verification: backup → temp restore DB → schema + record verification.
SOURCE_DATABASE_URL=postgresql://…/influenceos_staging scripts/dr-drill-staging.sh
```

The drill is staging-guarded (source must contain `staging`) and
non-destructive (restores into a throwaway DB). Record the result in
`docs/STAGING_ACCEPTANCE.md`.

**Full app-level recovery drill** (run once during acceptance; it briefly takes
staging down — never run against production data):

```bash
# 1. Stop the application tier (leave the DB up):
docker compose -p influenceos-staging -f docker-compose.staging.yml stop web api worker
# 2. Restore the latest good backup into the staging database:
scripts/restore-db.sh <staging-backup.dump> \
  --target "$DIRECT_DATABASE_URL" --yes
# 3. Apply any newer migrations, then restart the app:
docker compose -p influenceos-staging -f docker-compose.staging.yml run --rm migrate
docker compose -p influenceos-staging -f docker-compose.staging.yml up -d web api worker
# 4. Confirm health, records, attachments, and worker resumption:
scripts/smoke-staging.sh https://staging.influenceos.example.com
scripts/acceptance-staging.sh   # (or spot-check records + a known attachment)
```

## 8. Storage recovery (container vs object lifetime)

Object lifetime ≠ container lifetime. Verify the MinIO **volume**
(`staging_miniodata`) survives container recreation:

```bash
docker compose -p influenceos-staging -f docker-compose.staging.yml rm -sf minio
docker compose -p influenceos-staging -f docker-compose.staging.yml up -d minio
# then re-run an attachment download for a previously-uploaded object — it must still resolve.
```

For managed S3, verify access + any lifecycle/retention rules instead, and
confirm bucket versioning is enabled.

## 9. Monitoring on staging

Wire staging into the same stack as production (`deploy/observability/`):

```bash
# Prometheus (on the private network) scrapes the API's /metrics.
prometheus --config.file=deploy/observability/prometheus.yml
# Import deploy/observability/grafana-dashboard.json into Grafana.
```

`/metrics` is **internal only** — the staging proxy does not route it (the smoke
test asserts it is not publicly reachable). Verify real signals for: Web (up via
`/health`), API (`/health`, `/ready`, `influenceos_db_up`), Worker (`:4100/health`),
PostgreSQL (`influenceos_db_up` / `/ready`), Redis (worker `mode`), object
storage (acceptance upload), CPU/RAM/disk (host or node_exporter), API latency
(access-log `responseTimeMs`), 5xx (`influenceos_http_requests_total{status="5xx"}`),
failed jobs (worker logs / BullMQ), backup result (backup script exit + log).

## 10. Alert testing (trigger, don't just configure)

Safely exercise representative alerts on staging and confirm the alert path
(Alertmanager → Slack/email/PagerDuty) actually fires, restoring each service
immediately after:

| Alert | Safe trigger | Restore |
| --- | --- | --- |
| `InfluenceOSAPIDown` / worker down | `… stop worker` (or `api`) | `… start worker` |
| `InfluenceOSDatabaseDown` | briefly `… stop postgres` (expect `/ready`→503, `influenceos_db_up`→0) | `… start postgres` |
| Failed backup | run `backup-db.sh` with an unreachable `BACKUP_S3_*` | fix config, re-run |
| High 5xx | drive throwaway traffic to a deliberately 500-ing path in staging only | stop the traffic |

Record which alerts fired and where they were received in
`docs/STAGING_ACCEPTANCE.md`.

## 11. Social providers on staging

Staging does not require every provider to be live. Classify each and verify the
platform behaves correctly (manual-fallback) when credentials are absent — **no
fake "successful sync" status is ever shown**. Fill the table in
`docs/STAGING_ACCEPTANCE.md` using:

- **CONFIGURED** — staging/sandbox credentials present and working.
- **NEEDS CREDENTIALS** — supported, but no staging credentials supplied yet.
- **NEEDS PROVIDER APPROVAL** — requires app review/approval from the provider.
- **MANUAL FALLBACK** — no public API for the needed capability by design.

See `docs/SOCIAL_PROVIDER_MATRIX.md` for per-platform capability detail.

## 12. Release promotion

```
feature branch → CI (all jobs green) → deploy to staging → acceptance →
approved Git SHA → deploy the SAME SHA to production
```

The exact Git SHA validated on staging is the SHA promoted to production —
config differs, **code does not**. Never rebuild different source after staging
approval. Promotion is forbidden while any genuine 🔴 blocker remains in
`docs/STAGING_ACCEPTANCE.md`. Production deploy then uses
`scripts/deploy-production.sh <that-sha>` (see `docs/GITHUB_RELEASE_WORKFLOW.md`).
