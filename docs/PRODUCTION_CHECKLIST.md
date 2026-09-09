# Production Checklist

An ordered, verifiable pre-production checklist for InfluenceOS. Work top to
bottom; each item is phrased as a check with the exact command or file to verify
where one exists. Do not promote a release to production with any box unchecked.

---

## 1. Secrets and environment

- [ ] `AUTH_SECRET` is strong: at least 32 characters and **not** a default
      value. (Required in production; `apps/api/src/env.ts` fails fast otherwise.)
- [ ] `POSTGRES_PASSWORD` is set to a strong, non-default value.
- [ ] `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` are set to strong, non-default
      values.
- [ ] `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are set (used once,
      idempotently, by `prisma/bootstrap.ts`).
- [ ] All mandatory variables are present. `docker-compose.full.yml` requires
      each via `${VAR:?}`, and `apps/api/src/env.ts` validates the full
      environment at startup and exits `1` with a printed report if invalid.
- [ ] `.env.production` was created from `.env.production.example` and is **not**
      committed to the repository.

```bash
cp .env.production.example .env.production   # then fill in every value
```

## 2. TLS and reverse proxy

- [ ] Only ports **80** and **443** are publicly reachable. API (4000), worker
      (4100), PostgreSQL (5432), Redis (6379), MinIO (9000/9001), and `/metrics`
      are **not** publicly reachable.
- [ ] A reverse proxy is configured — `deploy/caddy/Caddyfile` (recommended;
      automatic Let's Encrypt TLS) or `deploy/nginx/influenceos.conf` — and
      routes `/api/v1`, `/api/docs`, `/api/openapi.json` to the API and
      everything else to the web app.
- [ ] Valid TLS certificates are in place on 443 (Caddy obtains them
      automatically via Let's Encrypt).
- [ ] `Strict-Transport-Security` (HSTS) is served in production (set in
      `apps/web/next.config.mjs`, production only).
- [ ] The proxy sets security headers and a request-body ceiling.

## 3. Database

- [ ] Migrations are applied with migrate deploy — **never** `prisma db push` in
      production.

```bash
pnpm db:deploy   # = prisma migrate deploy
```

- [ ] The seed is **not** run in production. (It is guarded behind
      `SEED_DEMO=true` and `CONFIRM_WIPE=true`; neither is set in production.)
- [ ] Runtime uses the pooled `DATABASE_URL`; migrations use the unpooled
      `DIRECT_DATABASE_URL`.
- [ ] Automated backups are scheduled (`scripts/backup-db.sh` — `pg_dump` custom
      format + retention + optional off-host S3).
- [ ] A restore drill has **passed** (backups are proven restorable):

```bash
scripts/restore-test.sh
```

## 4. Object storage

- [ ] Buckets are **private**; access is via presigned URLs only (two-phase
      signed uploads: initiate → PUT → complete).
- [ ] The storage backend is durable and backed up (`STORAGE_DRIVER=s3` for
      production-grade durability; `local` is the default and is not durable
      across hosts).
- [ ] Internal vs public endpoints are correct: `S3_INTERNAL_ENDPOINT`
      (server-side) and `S3_PUBLIC_ENDPOINT` (browser presign) are set to the
      right values, along with `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
      `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE`.
- [ ] `MAX_UPLOAD_MB` (default 100) and the server-side MIME allowlist are
      appropriate for the deployment.

## 5. Redis

- [ ] Redis requires a password.
- [ ] Redis persistence is configured (BullMQ queues rely on Redis).
- [ ] Redis (6379) is **not** publicly reachable.
- [ ] If running multiple API instances, `RATE_LIMIT_REDIS` is truthy and
      `REDIS_URL` is set so the rate limiter shares state across instances.

## 6. Observability

- [ ] Prometheus is scraping the API `/metrics` endpoint over the private network
      (`deploy/observability/prometheus.yml`), and `/metrics` is not exposed
      publicly.
- [ ] Alerts are wired (`deploy/observability/alerts.yml`): API down, DB down,
      high 5xx ratio (> 5%), high memory.
- [ ] The Grafana dashboard is imported
      (`deploy/observability/grafana-dashboard.json`).

## 7. Security

- [ ] Rate limiting is in effect: `RATE_LIMIT_MAX` (default 300) per
      `RATE_LIMIT_WINDOW` (default `1 minute`), with `/health`, `/ready`,
      `/metrics` allow-listed.
- [ ] Login lockout is configured: `LOGIN_MAX_ATTEMPTS` (default 10) consecutive
      failures opens a `LOGIN_LOCK_MINUTES` (default 15) window; per-IP login rate
      limit 20/min is in effect.
- [ ] Security headers are served from `apps/web/next.config.mjs`:
      `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`,
      `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy`, and (production)
      `Strict-Transport-Security`.
- [ ] Session cookies are `secure` in production (`io_at`, `io_rt` are
      `httpOnly` + `sameSite=lax` + `secure`), and the browser holds no tokens
      (BFF token transport).
- [ ] The secret scan is green (CI `security` job runs gitleaks; local config is
      `.gitleaks.toml`).

## 8. Release

- [ ] Release identity is injected at deploy time: `GIT_SHA`, `APP_VERSION`,
      `BUILD_TIME`. Confirm they surface on `/health`, in `/metrics`
      (`influenceos_build_info`), and on the web **Settings → Platform** page.
- [ ] An immutable git tag (or exact SHA) has been created for the release and is
      what gets deployed.

```bash
scripts/deploy-production.sh <git-sha-or-tag>
```

## 9. Verification (post-deploy)

- [ ] The smoke test passes against the deployed environment (non-destructive:
      `/health`, `/ready`, anonymous `401` on a protected route, web `/login`
      renders):

```bash
scripts/smoke-test.sh https://api.example.com https://app.example.com
```

- [ ] `/health` returns `200` with the expected `gitSha` / `version` /
      `buildTime` for this release.
- [ ] `/ready` returns `200 {status:"ready"}`.
- [ ] The worker `/health` (port 4100) reports `mode: "redis+bullmq"`.
