# Architecture

InfluenceOS is a **modular monolith with an API-first core** and dedicated background
worker processing. The backend API is the product; the web app and any future mobile
app are clients of the same versioned API.

## Layers

```
┌──────────────┐   ┌──────────────┐
│  Web client  │   │ Mobile (fut.)│      Clients — render only. No business logic.
│  Next.js 15  │   │  React Native│
└──────┬───────┘   └──────┬───────┘
       │  @influenceos/api-client (typed SDK)  │
       └───────────────┬───────────────────────┘
                       ▼
             ┌────────────────────┐
             │   Platform API     │   apps/api — Fastify, thin HTTP layer.
             │   /api/v1 + OpenAPI │   Validates (Zod), authenticates, maps errors.
             └─────────┬──────────┘
                       ▼
             ┌────────────────────┐        ┌──────────────┐
             │  Domain services   │◄───────│    Worker    │  apps/worker — BullMQ.
             │  @influenceos/domain│        │  monitoring  │  Calls the same services.
             │  ALL business rules │        └──────────────┘
             └─────────┬──────────┘
                       ▼
             ┌────────────────────┐
             │  Prisma / Postgres │   packages/database
             └────────────────────┘
```

### Why this shape (addendum §2, §38)

The web app **never** touches Prisma for product functionality and holds **no**
hidden server-only business logic. Everything a client can do is an API operation, so
a mobile app can perform the exact same operations. This is enforced structurally:
business logic physically lives in `packages/domain`, the API is a thin transport, and
the web app only depends on `@influenceos/api-client`.

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `@influenceos/shared` | Browser-safe: client-safe enums, **social provider adapters** + capability matrix, URL/embed logic, pure **metric calculations**, **audience-health** signals, formatting. No Prisma, no framework. | — |
| `@influenceos/contracts` | The API contract: request/filter **Zod schemas**, explicit **response DTOs** (never Prisma models), standardized **error** + **pagination** envelopes, and the code-level **Feature Registry**. | shared |
| `@influenceos/database` | Prisma schema, migrations, client singleton, seed. | — |
| `@influenceos/domain` | **All business rules** as `make<X>Service(ctx)` factories returning DTOs: auth, brands, influencers, social accounts, campaigns, deliverables, scripts, content + monitoring, costs, dashboard aggregation, reports, search, calendar, integrations, platform. | database, contracts, shared |
| `@influenceos/api-client` | Strongly-typed fetch SDK (single client for web + mobile). | contracts |

## Apps

### `apps/api` — Fastify
- All routes under **`/api/v1`** (explicit versioning so old mobile builds keep working).
- Per-request flow: `onRequest` resolves the actor from a Bearer token → route
  `preHandler` (`requireAuth`/`requireAdmin`) → handler builds per-request domain
  services (`servicesFor(request)`) → calls a service → returns a DTO.
- **OpenAPI** generated from the Zod route schemas → Swagger UI at `/api/docs`, JSON at
  `/api/openapi.json` (used to generate a future mobile SDK).
- **Standardized errors** (`{ error: { code, message, fieldErrors?, requestId } }`) —
  never leaks DB errors or stack traces.
- Security: helmet, CORS allowlist, cookie support, rate limiting.

### `apps/web` — Next.js (client only)
- **BFF token transport:** tokens live in httpOnly cookies on the Next origin. Server
  Components read the access token and call the API directly; client components call a
  same-origin proxy (`/api/bff/*`) that injects the token and transparently refreshes
  it. Middleware refreshes the access token and guards routes. Tokens are never exposed
  to JS. A mobile app skips this and calls the API directly with keychain-held tokens.
- App Router with a `(app)` route group carrying the shell (sidebar, topbar, brand
  switcher, Quick Add, command palette ⌘K, notifications, user menu, theme + locale/RTL
  toggles). i18n via next-intl (English + Arabic RTL), cookie-driven, no locale routing.
- Design system: Tailwind tokens (light/dark/brand accent) + Radix primitives.

### `apps/worker` — BullMQ
- Queues: `content-check`, `follower-sync`, `maintenance`. A repeatable maintenance
  sweep enqueues due content availability checks, stale follower syncs, and generates
  deliverable/campaign notifications. Retry + exponential backoff + rate limiters.
- Reuses domain logic (e.g. `content.refresh`) so web/API/worker produce identical
  results. Graceful inline fallback when Redis is unavailable. Health endpoint.

## Cross-cutting

- **Auth:** Argon2id hashing; short-lived JWT **access** tokens + rotating **refresh**
  tokens stored (hashed) on `DeviceSession` rows, enabling server-side revocation and
  mobile keychain storage later. `authenticate(token)` is stateless.
- **Provenance:** externally-sourced values carry a `DataSource` (Manual / Official API
  / Embed / Unavailable) surfaced in the UI. Missing metrics are `null` → shown as
  "N/A", never fabricated zeros.
- **Provider architecture:** one `SocialPlatformAdapter` interface; `getAdapter()`
  resolves the right implementation; each returns an explicit capability object and a
  `ManualAdapterFallback` guarantees graceful degradation. Embeds are strictly typed and
  origin-allowlisted (never raw provider HTML).
- **Feature Registry** (`packages/contracts`) is the single source of truth powering the
  admin **Platform & API** screens, mobile-readiness, and the generated matrix docs.

## Data flow example — "paste a published URL"

1. Web posts `POST /api/v1/content` `{ url, campaignId? }` via the API client.
2. API validates, resolves the actor, calls `content.create`.
3. Domain parses the URL → platform + external id, builds a safe embed descriptor,
   associates brand/campaign/influencer/deliverable, marks the deliverable published
   (advancing campaign progress), logs activity, and creates a notification.
4. The content appears in Live Content, What's New and the campaign — the web renders
   the embed via `SocialContentPlayer`; a mobile app would render the same DTO natively.
5. The worker later re-checks availability and syncs metrics on a schedule.
