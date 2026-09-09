# Operations Runbook

Day-2 operations for InfluenceOS in production. This runbook covers deploying,
observing, and recovering the platform. It assumes the production topology
described in `PRODUCTION_ARCHITECTURE.md`: a reverse proxy on 80/443 in front of
the web app (3000) and API (4000), with the worker (4100), PostgreSQL, Redis, and
object storage on the private network.

All commands are run from the repository root on the production host unless
otherwise noted.

---

## First deploy

### 1. Server prerequisites

- A host with Docker and the Docker Compose plugin.
- A reverse proxy in front of the stack — `deploy/caddy/Caddyfile` (recommended;
  automatic Let's Encrypt TLS) or `deploy/nginx/influenceos.conf`.
- Only ports **80** and **443** open to the internet. API (4000), worker (4100),
  PostgreSQL (5432), Redis (6379), MinIO (9000/9001), and `/metrics` must not be
  publicly reachable.

### 2. Configure the environment

Create `.env.production` from the template and fill in every required value:

```bash
cp .env.production.example .env.production
```

`docker-compose.full.yml` requires each secret via `${VAR:?}`, so a missing value
fails the command immediately. At minimum: `POSTGRES_PASSWORD`,
`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `AUTH_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_PASSWORD`. `AUTH_SECRET` must be at least 32 characters and must
not be a default value. The API additionally validates the whole environment at
startup (`apps/api/src/env.ts`) and exits `1` with a printed report if anything
is invalid.

Do **not** commit `.env.production`.

### 3. Bring up the stack

```bash
docker compose -f docker-compose.full.yml up -d
```

The `migrate` one-shot service applies database migrations and bootstraps the
first admin **before** the api, worker, and web services start. Healthchecks are
defined on postgres, redis, minio, api, and worker.

### 4. First admin bootstrap

The first admin is created by `prisma/bootstrap.ts` using
`BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`. It runs as part of the
`migrate` one-shot and is idempotent, so re-running it will not create
duplicates.

### 5. Smoke test

Verify the deployment is serving correctly (non-destructive):

```bash
scripts/smoke-test.sh https://api.example.com https://app.example.com
```

The smoke test checks `/health`, `/ready`, that an anonymous request to a
protected route returns `401`, and that the web `/login` page renders. It can
also perform an authenticated read if `SMOKE_EMAIL` / `SMOKE_PASSWORD` are set.

---

## Routine deploy

Deploy an exact, immutable git SHA or tag:

```bash
scripts/deploy-production.sh <git-sha-or-tag>
```

This script checks out the exact SHA, takes a pre-deploy backup, injects the
release metadata (`APP_VERSION`, `GIT_SHA`, `BUILD_TIME`), runs
`docker compose build` + `up`, applies migrations via the compose `migrate`
one-shot, and gates on `/health` and `/ready` before completing.

## Rollback

Redeploy an earlier, known-good immutable SHA:

```bash
scripts/rollback-production.sh <prev-good-sha>
```

If the rollback crosses a migration boundary, the script warns and requires
`--yes`, because the database is **not** auto-downgraded:

```bash
scripts/rollback-production.sh <prev-good-sha> --yes
```

Rolling back code across a migration while the database schema stays forward is a
manual-judgment situation — confirm the schema is compatible with the older code
before proceeding.

---

## Reading health

| Endpoint | Meaning | Expected |
|---|---|---|
| `GET /health` (API) | Liveness. Never rate-limited, no auth. | `200` with `{status:"ok", service, version, gitSha, buildTime, environment, uptimeSec}` |
| `GET /ready` (API) | Readiness. Runs a DB connectivity check. | `200 {status:"ready", checks:[...]}` when healthy; `503 {status:"not_ready", ...}` when the DB check fails |
| `GET /health` (worker, port 4100) | Worker liveness + mode. | `200` with `{status:"ok", service, version, gitSha, ..., mode, contentChecks, accountSyncs, notifications, lastMaintenanceAt}`. `mode` is `"redis+bullmq"` when Redis is reachable, `"inline-fallback"` when it is not. |
| `GET /metrics` (API) | Prometheus metrics. **Internal only.** | Prometheus text exposition including `influenceos_up`, `influenceos_db_up`, `influenceos_build_info`, `process_uptime_seconds`, `influenceos_http_requests_total` |

`/health`, `/ready`, and `/metrics` are allow-listed from rate limiting.

A worker reporting `mode: "inline-fallback"` means Redis is unreachable and jobs
are running inline rather than through BullMQ — treat this as a degraded state
(see the Redis playbook).

---

## Logs and request-id correlation

The API emits structured JSON logs (pino) with secret redaction on the
`authorization`, `cookie`, `set-cookie`, and `x-api-key` headers. There is one
access-log line per request containing `reqId`, `method`, `url`, `route`,
`statusCode`, `responseTimeMs`, and `actorId`.

Every response carries an `x-request-id` header. The API honors an inbound
`x-request-id` if present; otherwise it generates one of the form `req_<uuid>`.
Error response bodies include the same value as `requestId`.

To trace a request end to end:

1. Take the `x-request-id` from the client (response header) or the `requestId`
   from an error body.
2. Grep the API logs for that value in the `reqId` field to find the matching
   access-log line and any log lines emitted during that request.

```bash
docker compose -f docker-compose.full.yml logs api | grep req_<uuid>
```

Because `trustProxy` is on, the logged client information reflects the reverse
proxy's forwarded headers.

---

## Common operational tasks

### Restart a service

```bash
docker compose -f docker-compose.full.yml restart api
```

Replace `api` with `web` or `worker` as needed. Shutdown is graceful: the API
drains in-flight requests (Fastify close), disconnects Prisma, and has a 10s
hard-timeout guard on `SIGTERM`/`SIGINT`. The worker drains active jobs
(`Worker.close`), closes queues and Redis, disconnects Prisma, and has a 15s
hard-timeout.

### Scale the API (multiple instances)

When running more than one API instance, the rate limiter must share state.
Enable the Redis-backed rate-limit store by setting `RATE_LIMIT_REDIS` truthy and
providing `REDIS_URL`; otherwise each instance keeps its own in-memory counters
and the effective limit multiplies by the instance count.

### Rotate `AUTH_SECRET`

`AUTH_SECRET` signs JWTs and derives the key for AES-GCM envelope encryption of
provider credentials. Rotating it has two consequences:

- **All existing sessions are invalidated** — issued access and refresh tokens no
  longer validate, so all users must sign in again.
- **Envelope encryption is re-keyed** — provider credentials encrypted under the
  old secret must be re-encrypted under the new one; plan for re-entering or
  re-encrypting provider credentials.

Set the new value (≥ 32 chars, non-default) in `.env.production` and redeploy.

### Reset a locked-out account

Account lockout opens after `LOGIN_MAX_ATTEMPTS` (default 10) consecutive failed
logins and lasts `LOGIN_LOCK_MINUTES` (default 15). The simplest resolution is to
wait out the lock window. A user who knows their current password can use the
change-password endpoint (which revokes all sessions). There is also a per-IP
login rate limit of 20/min that can produce login failures independent of the
per-account lockout.

### Take a manual backup

```bash
scripts/backup-db.sh
```

Produces a `pg_dump` custom-format backup with retention, and optionally copies
it off-host to S3.

### Run the restore drill

```bash
scripts/restore-test.sh
```

Restores a backup into a scratch database and verifies the table inventory and
row counts. Use this to confirm backups are actually restorable — do not treat
untested backups as valid.

To perform a real (destructive) restore into the live database, use
`scripts/restore-db.sh <file|s3-url> --yes`. The `--yes` flag is required because
the restore is destructive.

---

## Incident playbooks

### API down

- **Symptoms:** `/health` unreachable or non-200; `influenceos_up` alert (API
  down) firing; web app errors.
- **First look:** API container status and logs
  (`docker compose -f docker-compose.full.yml logs api`); confirm the process is
  running and did not fail-fast on env or DB at boot (the API fails fast if the
  DB is unreachable at boot, and env.ts exits 1 on invalid config).
- **Action:** restart the API; if it will not stay up, check the env report it
  prints and the DB connectivity.

### DB down / unreachable

- **Symptoms:** `/ready` returns `503 {status:"not_ready"}`; `influenceos_db_up`
  is 0; DB-down alert firing; API may fail to boot.
- **First look:** PostgreSQL container/health and connectivity from the API to
  `DATABASE_URL`.
- **Action:** restore database availability. The API is designed to fail fast
  when the DB is unreachable at boot and `/ready` will report `not_ready` while
  the DB check fails; it should recover once the DB is reachable again.

### Redis down

- **Symptoms:** worker `/health` reports `mode: "inline-fallback"`; queue
  processing is degraded.
- **Behavior:** the worker falls back to running jobs **inline** instead of
  through BullMQ. If the rate-limit store is Redis-backed and Redis is
  unavailable, the limiter uses `skipOnError` (requests are not blocked by the
  limiter failing).
- **First look:** Redis container/health and `REDIS_URL` connectivity.
- **Action:** restore Redis; the worker returns to `redis+bullmq` mode once Redis
  is reachable.

### Object storage down

- **Symptoms:** upload/download failures; presign or two-phase upload
  (initiate → PUT → complete) errors.
- **First look:** storage backend health; for S3/MinIO check
  `S3_INTERNAL_ENDPOINT` (server-side) and `S3_PUBLIC_ENDPOINT` (browser
  presign), bucket, and credentials.
- **Action:** restore the storage backend; verify buckets remain private and
  presigned URLs are being issued.

### High 5xx

- **Symptoms:** high 5xx-ratio alert (> 5%) firing;
  `influenceos_http_requests_total{status-class="5xx"}` rising.
- **First look:** API logs filtered to 5xx access-log lines; correlate by `route`
  and by `reqId` for individual failing requests. Check `/ready` and
  `influenceos_db_up` to rule out a DB dependency; check memory
  (`process_resident_memory_bytes`, high-memory alert).
- **Action:** address the dominant failing route/dependency; consider rollback
  (`scripts/rollback-production.sh <prev-good-sha>`) if the regression correlates
  with a recent deploy.

---

## Escalation and where to look first

| Signal | Look first at | Likely runbook |
|---|---|---|
| API `/health` failing | API container + logs | API down |
| `/ready` = 503, `influenceos_db_up` = 0 | PostgreSQL health, `DATABASE_URL` | DB down / unreachable |
| worker `mode: "inline-fallback"` | Redis health, `REDIS_URL` | Redis down |
| Upload/media errors | Storage backend, S3 endpoints/buckets | Object storage down |
| High 5xx alert | API logs by `route`/`reqId`, `/ready`, memory | High 5xx |
| Alerts generally | `deploy/observability/alerts.yml`, Grafana dashboard | (per alert above) |

Alerting and dashboards are defined in `deploy/observability/`
(`prometheus.yml`, `alerts.yml`, `grafana-dashboard.json`). The bundled alerts
cover API down, DB down, high 5xx ratio (> 5%), and high memory.
