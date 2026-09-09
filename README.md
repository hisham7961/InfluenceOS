# InfluenceOS

A live **influencer marketing command center** for teams managing many brands and
creators across Instagram, TikTok, YouTube, Snapchat and X. Not a CRUD admin — a
visual, content-first operations platform: Mission Control, a live content wall with
in-app players, campaign control rooms, an influencer 360, cost tracking, background
content monitoring, and analytics.

> Influencers never log in. All data is managed internally by staff. No AI features.

## Core principle: API-first, mobile-ready

InfluenceOS is built as **a platform API with multiple clients**, not a web app that
later gets an API:

```
Web client  ─┐
Mobile app  ─┼─►  Platform API (/api/v1)  ─►  Domain services  ─►  Repository  ─►  PostgreSQL
Workers     ─┘         (Fastify + OpenAPI)        (business logic)
```

Every meaningful business capability is exposed through the versioned API and
documented via OpenAPI. The web app consumes the **same typed client** a future
iOS/Android app will use — no hidden web-only business logic. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) and
[`docs/MOBILE_READINESS.md`](docs/MOBILE_READINESS.md).

## Tech stack

- **Monorepo:** pnpm workspaces + Turborepo
- **API:** Node + **Fastify**, Zod validation, `@fastify/swagger` (OpenAPI at `/api/docs`)
- **Domain:** framework-agnostic TypeScript services (shared by API + worker)
- **Web:** **Next.js 15** (App Router, React 19), Tailwind, Radix UI, TanStack Query,
  next-intl (English + Arabic RTL), light/dark, cmdk command palette, Recharts
- **Database:** PostgreSQL + **Prisma**
- **Background jobs:** Redis + **BullMQ**
- **Auth:** Argon2 password hashing, JWT access + rotating refresh tokens, device sessions
- **Storage:** S3-compatible (MinIO in dev)

## Monorepo layout

```
apps/
  api/        Fastify HTTP layer (thin) → domain services, OpenAPI, auth
  web/        Next.js client (consumes the API client only)
  worker/     BullMQ monitoring / snapshots / notifications
packages/
  contracts/  API contract: DTOs, request/filter schemas, error + pagination
              envelopes, client-safe enums, the Feature Registry
  domain/     ALL business logic as services returning DTOs (not Prisma models)
  database/   Prisma schema, migrations, seed
  shared/     provider adapters + capability matrix, url/embed logic, pure metric
              calculations, audience-health signals, formatting (browser-safe)
  api-client/ typed SDK used by web (and future mobile)
docs/         ARCHITECTURE, DATABASE, SECURITY, DEPLOYMENT, API, SOCIAL_PROVIDER_MATRIX,
              FEATURE_MATRIX, MOBILE_READINESS, BUILD_STATUS
```

## Quick start

```bash
# 1. Infra (Postgres, Redis, MinIO)
docker compose up -d

# 2. Env
cp .env.example .env            # defaults match docker-compose

# 3. Install + database
pnpm install
pnpm db:migrate                 # apply migrations
pnpm db:seed                    # realistic demo data

# 4. Run everything (api :4000, web :3000, worker :4100)
pnpm dev
# or individually:
pnpm api:dev   |   pnpm web:dev   |   pnpm worker:dev
```

Open **http://localhost:3000** and sign in:

| Role  | Email                    | Password       |
|-------|--------------------------|----------------|
| Admin | `admin@influenceos.app`  | `Password123!` |
| Staff | `sarah@influenceos.app`  | `Password123!` |

- API docs (Swagger UI): **http://localhost:4000/api/docs**
- OpenAPI JSON: **http://localhost:4000/api/openapi.json**

## Common scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run api + web + worker |
| `pnpm build` | Build all packages/apps |
| `pnpm typecheck` | Typecheck the whole monorepo |
| `pnpm test` | Unit tests |
| `pnpm db:migrate` / `db:seed` / `db:studio` / `db:reset` | Prisma workflows |
| `pnpm docs:generate` | Regenerate the feature/provider matrix docs from code |

## Social providers

The product works **fully in manual-fallback mode with no credentials**. Adapters
advertise honest, graded capabilities (e.g. TikTok profile sync is authorization-
dependent; YouTube/X stats need an API key). Content embeds use each platform's
official mechanism through a strict iframe allowlist. See
[`docs/SOCIAL_PROVIDER_MATRIX.md`](docs/SOCIAL_PROVIDER_MATRIX.md). Add credentials in
`.env` to light up official sync — nothing else changes.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DATABASE.md`](docs/DATABASE.md) ·
  [`docs/API.md`](docs/API.md) · [`docs/SECURITY.md`](docs/SECURITY.md) ·
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/SOCIAL_PROVIDER_MATRIX.md`](docs/SOCIAL_PROVIDER_MATRIX.md) ·
  [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) ·
  [`docs/MOBILE_READINESS.md`](docs/MOBILE_READINESS.md)
- [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) — current implementation status
- [`CONTRIBUTING.md`](CONTRIBUTING.md)
