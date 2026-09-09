# Deployment

How to run InfluenceOS locally and how to deploy it. Covers prerequisites, local
development, the full environment variable reference, production notes, and what
CI checks on every push.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **22.x** | Matches `actions/setup-node` in CI (`.github/workflows/ci.yml`). `package.json` declares `"engines": { "node": ">=20.0.0" }` as a floor, but target 22 to match CI. |
| pnpm | **10.33.0** | Pinned via `"packageManager": "pnpm@10.33.0"` in the root `package.json`. Install with `corepack enable && corepack prepare pnpm@10.33.0 --activate`, or use the version pnpm/action-setup installs in CI. |
| Docker (+ Compose) | any recent version | Runs local Postgres, Redis and MinIO via `docker-compose.yml`. |

Two compose files are provided:

- **`docker-compose.yml`** — infrastructure only (Postgres/Redis/MinIO), for
  local development where the apps run on the host with Node/tsx/Next.js.
- **`docker-compose.full.yml`** — the **whole stack** containerized: infra plus
  the `api`, `worker` and `web` services built from `docker/Dockerfile.{api,worker,web}`,
  with a `migrate` one-shot that applies migrations and bootstraps a first admin.
  Object storage is private (S3 driver against MinIO; no anonymous access).

## 2. Local development

```bash
# 1. Start infra: Postgres (5432), Redis (6379), MinIO (9000/9001)
docker compose up -d

# 2. Copy env config — defaults already match docker-compose
cp .env.example .env

# 3. Install workspace dependencies
pnpm install

# 4. Apply Prisma migrations (dev mode — may create new migrations)
pnpm db:migrate

# 5. Seed realistic demo data — the demo seed is DESTRUCTIVE and opt-in:
SEED_DEMO=true CONFIRM_WIPE=true pnpm db:seed:demo

# 6. Run api + web + worker together
pnpm dev
```

### Whole stack in Docker

```bash
# Build and run pg + redis + minio + migrate/bootstrap + api + worker + web
BOOTSTRAP_ADMIN_EMAIL=admin@influenceos.local \
BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-one' \
docker compose -f docker-compose.full.yml up --build
# Web → http://localhost:3000 · API → http://localhost:4000
```

`pnpm dev` runs `turbo run dev --parallel`, which fans out to each app's own `dev`
script:

| Service | Script | Port | URL |
|---|---|---|---|
| API (Fastify) | `pnpm api:dev` → `apps/api` `dev` (`tsx watch src/index.ts`) | `4000` | http://localhost:4000 |
| Web (Next.js) | `pnpm web:dev` → `apps/web` `dev` (`next dev -p 3000`) | `3000` | http://localhost:3000 |
| Worker (BullMQ) | `pnpm worker:dev` → `apps/worker` `dev` (`tsx watch src/index.ts`) | `4100` | http://localhost:4100/health |

You can also run any one of them individually with `pnpm api:dev`, `pnpm web:dev`,
or `pnpm worker:dev`.

Useful endpoints once the API is up:
- Health check: `GET /health`
- Swagger UI: `GET /api/docs`
- Raw OpenAPI JSON: `GET /api/openapi.json`

Other database workflows (all defined in the root `package.json`, proxied to
`packages/database`):

| Command | What it does |
|---|---|
| `pnpm db:generate` | Regenerate the Prisma client (`prisma generate`) |
| `pnpm db:migrate` | Dev migration flow (`prisma migrate dev`) — may prompt to create a migration |
| `pnpm db:deploy` | Apply pending migrations without prompting (`prisma migrate deploy`) — use in CI/prod |
| `pnpm db:seed` | Run `packages/database/prisma/seed.ts` |
| `pnpm db:reset` | **Destructive.** `prisma migrate reset --force` |
| `pnpm db:studio` | Open Prisma Studio against the configured database |

The API, worker and database packages load `.env` via `dotenv-cli` (`dotenv -e
../../.env -- ...`), so `.env` must live at the **repo root**, not inside `apps/*`.

## 3. Environment variables

All variables are documented with defaults in `.env.example`. Copy it to `.env` and
adjust as needed. Grouped below, with which ones are actually required to boot.

### Core / database

| Variable | Required? | Default (`.env.example`) | Notes |
|---|---|---|---|
| `NODE_ENV` | optional | `development` | Fastify log level is `info` in `production`, `warn` otherwise (`apps/api/src/app.ts`). |
| `DATABASE_URL` | **required** | `postgresql://postgres:postgres@localhost:5432/influenceos?schema=public` | Pooled connection; enforced non-empty by `apps/api/src/env.ts` (zod). Also Prisma's `datasource db { url = env("DATABASE_URL") }`. |
| `DIRECT_DATABASE_URL` | required for migrations | same as `DATABASE_URL` in dev | Prisma's `directUrl`, used by `prisma migrate` (`packages/database/prisma/schema.prisma`). Point this at an unpooled connection in production (e.g. bypass PgBouncer) if you use connection pooling. |

### Redis (BullMQ)

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `REDIS_URL` | optional but recommended | `redis://localhost:6379` | Used by `apps/worker`. If Redis is unreachable at boot, the worker degrades to an in-process polling fallback instead of BullMQ queues (`apps/worker/src/index.ts` — `startFallback()`), so it isn't a hard requirement, but production should always run real Redis for reliable background jobs. |

### Authentication

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `AUTH_SECRET` | **required** | placeholder string | Signs session JWTs (Argon2 password hashing + JWT access/refresh, per `README.md`). `apps/api/src/env.ts` enforces **min 16 characters**; `.env.example` recommends 32+ random bytes: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. `packages/domain/src/services/auth.service.ts` throws `AppError('INTERNAL', ...)` if unset. |
| `AUTH_SESSION_TTL` | optional | `604800` (7 days, seconds) | Session lifetime, read in `auth.service.ts`. |

### App / API wiring

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | optional | `http://localhost:3000` | Public app URL; also used as the Swagger `servers[0].url` in `apps/api/src/app.ts` and as `apiBaseUrl` in the platform status endpoint. |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | optional | `en` | `en` or `ar` (next-intl, Arabic is RTL). |
| `API_PORT` | optional | `4000` | Fastify listen port (`apps/api/src/env.ts`, coerced number). |
| `API_HOST` | optional | `0.0.0.0` | Fastify listen host. |
| `WEB_ORIGIN` | optional | `http://localhost:3000` | **Comma-separated** list of origins allowed by CORS (`@fastify/cors`, credentials enabled) — see `corsOrigins()` in `apps/api/src/env.ts`. Set this to your real web origin(s) in production. |
| `INTERNAL_API_URL` | optional | `http://localhost:4000` | Where the Next.js server (SSR / BFF) reaches the API internally — read directly via `process.env.INTERNAL_API_URL` in `apps/web/src/middleware.ts` and `apps/web/src/lib/session.ts`. In containerized deployments this is typically an internal service DNS name, not a public URL. |

### Object storage (S3-compatible / MinIO)

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `STORAGE_DRIVER` | optional | `local` | `s3` to use S3/MinIO, `local` for signed-proxy disk storage. |
| `S3_ENDPOINT` | s3 only | `http://localhost:9000` | S3-compatible endpoint (MinIO in dev). |
| `S3_REGION` | optional | `us-east-1` | |
| `S3_ACCESS_KEY_ID` | s3 only | `minioadmin` | |
| `S3_SECRET_ACCESS_KEY` | s3 only | `minioadmin` | |
| `S3_BUCKET` | optional | `influenceos` | Matches the bucket the `minio-setup` compose service creates (`mc mb --ignore-existing local/influenceos`). The bucket is **private** — the compose file no longer runs `mc anonymous set`. |
| `S3_FORCE_PATH_STYLE` | optional | `true` | Needed for MinIO/path-style S3 clients. |
| `MAX_UPLOAD_MB` | optional | `50` | Server-enforced upload size ceiling. |
| `LOCAL_UPLOAD_DIR` | local only | `./uploads` | Disk location for the local driver (git-ignored, traversal-guarded). |

> **No `S3_PUBLIC_URL`.** Objects are private; every download is served through a
> short-lived **presigned GET** (S3) or a **signed proxy link** (local). There is
> no public bucket and no permanent public file URL — see `docs/SECURITY.md §9`.

Object storage is now **fully implemented**: two-phase signed uploads
(`POST /files` → `PUT` → `POST /files/complete`), private-by-default buckets, and
signed downloads for both the `s3` and `local` drivers. These variables drive
real uploads and downloads, not just a health indicator.

### Content monitoring worker

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `MONITOR_CRON` | optional | `*/30 * * * *` | Cron pattern for the maintenance sweep (`apps/worker/src/index.ts`). |
| `MONITOR_BATCH_SIZE` | optional | `25` | Max monitoring checks per provider per run. |
| `WORKER_PORT` | optional | `4100` | Port for the worker's own `/health` HTTP endpoint. |

### Optional social provider credentials

All of these are **optional** — per `README.md`, "the product works fully in
manual-fallback mode with no credentials." Adapters advertise reduced capabilities
when a credential is missing (see `docs/SOCIAL_PROVIDER_MATRIX.md`).

| Variable | Provider | Purpose |
|---|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 | Public channel/video stats + oEmbed |
| `X_API_BEARER_TOKEN` | X (Twitter) API v2 | Bearer token for stats; oEmbed used for embeds |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_ACCESS_TOKEN` | Meta / Instagram Graph API | Professional accounts only; oEmbed for embeds |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok | Display/embed only — no creator OAuth in this product |
| `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` | Snapchat | Manual/URL-based by default — no public profile API |

## 4. Production notes

There is no committed Dockerfile, Kubernetes manifest, or PM2 ecosystem file in
this repo — the guidance below describes how to run the existing `build`/`start`
scripts in a production-like environment; adapt it to whatever platform you
target.

### Build

```bash
pnpm install --frozen-lockfile
pnpm db:generate     # prisma generate (also runs as part of each package's build via turbo `generate` dependency)
pnpm build           # turbo run build — builds every app/package
```

`turbo.json` wires `build` to depend on `^build` and `^generate`, so building the
workspace regenerates the Prisma client first. Per-app build behavior:

- **`apps/api`** — `build` is `tsc --noEmit` (type-checking only; the API runs
  directly from TypeScript via `tsx`, it does not emit a `dist/`).
- **`apps/web`** — `build` is `next build`, producing `apps/web/.next`.
- **`apps/worker`** — `build` is `tsc --noEmit`, same as the API: it runs via `tsx`.

### Running the services

**API** (`apps/api`) — run with `tsx` (or transpile with your own toolchain and run
with plain `node`/`node --loader`):

```bash
cd apps/api
NODE_ENV=production node --import tsx src/index.ts
# or, using the package script (loads ../../.env via dotenv-cli):
pnpm start
```

It listens on `API_HOST:API_PORT` (default `0.0.0.0:4000`) — see
`apps/api/src/index.ts`.

**Worker** (`apps/worker`) — same pattern:

```bash
cd apps/worker
NODE_ENV=production node --import tsx src/index.ts
# or: pnpm start
```

Scale the worker **independently of the API** — it's a separate BullMQ consumer
process with its own `/health` endpoint on `WORKER_PORT` (default `4100`). Run
multiple worker instances against the same `REDIS_URL` for horizontal scaling;
BullMQ handles distributing jobs across them. If Redis is unreachable at boot the
worker still starts but falls back to a single in-process polling loop
(`startFallback()` in `apps/worker/src/index.ts`) — do not rely on this fallback in
production, since it doesn't scale across replicas.

**Web** (`apps/web`) — standard Next.js production server:

```bash
cd apps/web
pnpm build
pnpm start   # next start -p 3000
```

`next.config.mjs` does not currently set `output: 'standalone'`; `next start`
requires the full `apps/web` + workspace `node_modules` to be present on the
target. If you want a minimal standalone deployment (e.g. a slim container image),
add `output: 'standalone'` to `apps/web/next.config.mjs` and run the generated
`.next/standalone/server.js` instead.

For any of the three services, put them under a process supervisor for restarts
and log management — PM2, systemd, or your container orchestrator's own restart
policy all work; nothing in the app assumes a specific one. Example PM2 usage:

```bash
pm2 start "pnpm start" --name influenceos-api    --cwd apps/api
pm2 start "pnpm start" --name influenceos-web    --cwd apps/web
pm2 start "pnpm start" --name influenceos-worker --cwd apps/worker
```

If containerizing, build one image per app (api, web, worker) from this monorepo
(no Dockerfiles are checked in yet, so you'll need to author them — a standard
multi-stage Node 22 + pnpm image works, running `pnpm --filter <pkg> ...` per
stage) and run migrations as a one-off job/init container rather than from inside
the API process.

### Migrations

Always use the non-interactive deploy command in CI/production, never `db:migrate`
(which is the interactive dev flow and can prompt or create migrations):

```bash
pnpm db:deploy   # prisma migrate deploy
```

Run this once per deployment, before starting the API/worker, against
`DATABASE_URL`/`DIRECT_DATABASE_URL` pointed at your production database. It only
applies already-committed migrations from `packages/database/prisma/migrations/`.

### Networking, auth, and CORS

- **TLS**: terminate TLS in front of the API (load balancer, reverse proxy, or
  ingress) — Fastify itself is not configured with HTTPS in this repo.
  `trustProxy: true` is already set in `apps/api/src/app.ts`, so `X-Forwarded-*`
  headers from a reverse proxy are honored.
- **`AUTH_SECRET`**: set a long, random, unique secret per environment (32+ random
  bytes recommended, per `.env.example`; the API enforces a minimum of 16
  characters). Never reuse the dev/CI placeholder values.
- **`WEB_ORIGIN`**: set to your real web origin(s), comma-separated if there are
  several (e.g. a marketing domain and an app subdomain). This directly controls
  the `@fastify/cors` allowlist; the API also sends credentials (cookies), so a
  correct, explicit origin list matters.
- **`INTERNAL_API_URL`**: point this at how the Next.js server reaches the API
  *internally* (e.g. a private service DNS name or `localhost` if co-located),
  which may differ from the public API URL your browser clients use.

## 5. CI overview

`.github/workflows/ci.yml` defines a `CI` workflow that runs on every push to
`main` and every pull request (with `concurrency` cancel-in-progress per ref).

The `build` job (`Lint · Typecheck · Test · Build`) runs on `ubuntu-latest` with
Postgres 16 and Redis 7 as service containers (health-checked), and this pipeline,
in order:

1. **Checkout** — `actions/checkout@v4`
2. **Setup pnpm** — `pnpm/action-setup@v4`, pinned to `10.33.0`
3. **Setup Node** — `actions/setup-node@v4`, Node **22**, with pnpm caching
4. **Install** — `pnpm install --frozen-lockfile`
5. **Generate Prisma client** — `pnpm db:generate`
6. **Apply migrations** — `pnpm db:deploy` (against the Postgres service container)
7. **Typecheck** — `pnpm typecheck`
8. **Lint** — `pnpm lint`
9. **Unit tests** — `pnpm test`
10. **Seed (smoke)** — `pnpm db:seed` (verifies the seed script runs cleanly against
    a freshly migrated database)
11. **Build** — `pnpm build`

CI environment variables are set inline in the workflow: `DATABASE_URL`,
`DIRECT_DATABASE_URL` (both pointing at the service-container Postgres),
`REDIS_URL`, `AUTH_SECRET` (a fixed CI-only placeholder), `NEXT_PUBLIC_APP_URL`,
`INTERNAL_API_URL`.

A second job, `e2e` (Playwright), is defined but currently disabled
(`if: ${{ false }}`) pending Docker images for the full stack — see
`apps/web/e2e` and the placeholder step in `ci.yml`.

To reproduce the CI pipeline locally:

```bash
docker compose up -d postgres redis   # or run your own Postgres 16 / Redis 7
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm typecheck
pnpm lint
pnpm test
pnpm db:seed
pnpm build
```
