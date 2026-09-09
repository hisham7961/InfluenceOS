# InfluenceOS HTTP API

InfluenceOS is API-first: `apps/api` (Fastify) is the product's single source of
truth, `apps/web` (Next.js) is a client of it via `@influenceos/api-client`, and a
future mobile app is meant to consume the exact same versioned API with no hidden
server-only logic anywhere else. This document describes that HTTP surface.

Source of truth for everything below:

- Server bootstrap, error handling, OpenAPI registration: `apps/api/src/app.ts`
- Route handlers: `apps/api/src/routes/*.routes.ts`
- Typed client (one method per endpoint): `packages/api-client/src/index.ts`
- Error contract: `packages/contracts/src/errors.ts`
- Pagination contract: `packages/contracts/src/pagination.ts`
- Response DTOs: `packages/contracts/src/dto/index.ts` (+ `client-config.ts`)
- Request/query Zod schemas: `packages/contracts/src/requests/index.ts`
- Feature Registry (endpoint ↔ feature mapping): `packages/contracts/src/registry/features.ts`

## Base URL & versioning

The API listens on `API_HOST:API_PORT` (`apps/api/src/env.ts`), defaulting to
`http://localhost:4000` in development. Every product route is mounted under a
single explicit version prefix:

```
API_PREFIX = /api/v1   (packages/contracts/src/index.ts)
```

All routes registered in `apps/api/src/routes/index.ts` are mounted under this
prefix (`app.register(async (scoped) => registerRoutes(scoped), { prefix: API_PREFIX })`
in `apps/api/src/app.ts`). The prefix is explicit and versioned so that older
mobile app builds keep working against `/api/v1` even as the API evolves.

Two routes live outside the version prefix:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check (`{ status: 'ok', service: 'influenceos-api' }`). Exempt from rate limiting. |
| GET | `/api/openapi.json` | Raw OpenAPI 3 document (see below). |

## OpenAPI & interactive docs

The API generates its OpenAPI schema directly from the same Zod schemas used for
request validation (`@fastify/swagger` + `fastify-type-provider-zod`'s
`jsonSchemaTransform`), so the contract and the documentation cannot drift apart:

- **Swagger UI** — `GET /api/docs` (`@fastify/swagger-ui`, `routePrefix: '/api/docs'`).
- **Raw OpenAPI JSON** — `GET /api/openapi.json`. This is the intended input for
  **generating a future mobile SDK** (iOS/Android) the same way
  `@influenceos/api-client` was hand-written for the web app — see "Mobile SDK
  generation" below.
- The document declares a single `bearerAuth` security scheme (`http`, `bearer`,
  `JWT`) applied by default to every operation; routes with no `preHandler`
  auth guard (e.g. login, refresh, `/client-config`) are effectively public
  despite the default security block.
- Tags group operations exactly as in the endpoint reference below: `Auth`,
  `Brands`, `Influencers`, `Campaigns`, `Content`, `Dashboard`, `Reports`,
  `Calendar`, `Notifications`, `Activity`, `Search`, `Settings`, `Platform`.

## Authentication

Auth is stateless bearer-token based. Passwords are hashed with Argon2id;
sessions are short-lived JWT **access** tokens plus rotating **refresh** tokens
persisted (hashed) as `DeviceSession` rows, which is what makes server-side
session listing/revocation and future mobile keychain storage possible
(`docs/ARCHITECTURE.md` "Cross-cutting").

### Log in

```
POST /api/v1/auth/login
Body: { email, password, device? }        (requests.loginSchema)
Rate limit: 20 requests / minute (route-level, tighter than the global limit)
→ 200 AuthResultDTO
```

`AuthResultDTO` (`packages/contracts/src/dto/index.ts`):

```ts
{
  user: UserDTO;              // { id, email, name, role, avatarUrl, locale, theme }
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;   // ISO timestamp
    refreshTokenExpiresAt: string;  // ISO timestamp
    tokenType: 'Bearer';
  };
}
```

### Authenticated requests

Send the access token on every subsequent request:

```
Authorization: Bearer <accessToken>
```

`apps/api/src/http.ts#resolveActor` runs on every request (`onRequest` hook in
`app.ts`) and looks for the token in either the `Authorization: Bearer …` header
or an `access_token` cookie, falling back to no actor (not an error) if neither
is present. Routes then opt into enforcement with the `requireAuth` /
`requireAdmin` preHandlers — most product routes require an authenticated actor;
a handful (`requireAdmin`) additionally require `role === 'ADMIN'`.

> The **web app** stores tokens in httpOnly cookies on the Next.js origin and
> calls the API through a same-origin BFF proxy that injects/refreshes them, so
> tokens are never exposed to browser JS. A **mobile client** (or any other
> direct API consumer) skips that proxy entirely and just sends
> `Authorization: Bearer <token>` — both transports hit the identical `/api/v1`
> endpoints.

### Refresh / logout / sessions

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/refresh` | Exchange a refresh token for a new token pair. Body `{ refreshToken? }`; falls back to the `refresh_token` cookie if omitted. |
| POST | `/api/v1/auth/logout` | Revoke the current session. Body `{ refreshToken? }` → `204 No Content`. |
| GET | `/api/v1/auth/me` | Current authenticated user → `UserDTO`. Requires auth. |
| GET | `/api/v1/auth/sessions` | List the actor's active device sessions → `DeviceSessionDTO[]`. Requires auth. |
| DELETE | `/api/v1/auth/sessions/:id` | Revoke one device session → `204`. Requires auth. |

`DeviceSessionDTO`: `{ id, client, deviceName, appVersion, lastActiveAt, createdAt, current }`.

### User administration (admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/users` | List all users. `requireAdmin`. |
| POST | `/api/v1/users` | Create a staff/admin user (`requests.registerUserSchema`) → `201 UserDTO`. `requireAdmin`. |

## Error envelope

Every non-2xx response — validation failures, domain errors, auth failures,
rate limiting, unhandled exceptions — is normalized to one JSON shape by the
global error handler in `apps/api/src/app.ts` (`ApiErrorBody`,
`packages/contracts/src/errors.ts`). Raw database errors and stack traces are
never leaked to clients; unhandled errors are logged server-side and returned
as a generic `INTERNAL` error.

```ts
{
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    fieldErrors?: { field: string; message: string }[];
    requestId?: string;   // matches the request's genReqId, e.g. "req_ab12cd34ef"
  };
}
```

| Code | HTTP status | When |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Request body/query failed Zod schema validation (`fieldErrors` populated with `{field, message}` per issue), or a domain-level `AppError` explicitly uses this code. |
| `BAD_REQUEST` | 400 | Malformed request (e.g. a domain `AppError.badRequest`, or any other 4xx Fastify error without a more specific mapping). |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired bearer token, or a `requireAuth` guard failed. |
| `FORBIDDEN` | 403 | Authenticated but lacking permission, e.g. a `requireAdmin` guard failed for a non-admin actor. |
| `NOT_FOUND` | 404 | No matching resource, or no route matches the method/path (`setNotFoundHandler`). |
| `CONFLICT` | 409 | Domain-level conflict (e.g. a uniqueness rule) raised as an `AppError`. |
| `RATE_LIMITED` | 429 | `@fastify/rate-limit` tripped (300 req/min global default, tighter per-route limits such as login's 20/min). |
| `MAINTENANCE` | 503 | Reserved for maintenance-mode responses (see Client Config's `maintenanceMode`). |
| `INTERNAL` | 500 | Any unhandled exception. Logged server-side with the request id; message is always the generic "Something went wrong. Please try again." |

Domain errors are raised as `AppError` (`@influenceos/domain`) carrying their
own `httpStatus`/`code`, so business-rule failures map 1:1 onto this table
instead of leaking as generic 500s.

The typed client mirrors this exactly: every non-2xx response throws
`ApiError` (`packages/api-client/src/core.ts`) with `.status`, `.code`,
`.message`, `.fieldErrors`, `.requestId`, `.details`, plus a convenience
`.isAuth` getter for `code === 'UNAUTHORIZED'`.

## Pagination

InfluenceOS uses exactly one pagination system with two styles, chosen per
endpoint by data shape (`packages/contracts/src/pagination.ts`, addendum §29):
**offset** pagination for bounded management tables, **cursor** pagination for
large, frequently-appended feeds.

### Offset (management lists)

```ts
interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
```

Query params (`offsetQuerySchema`, extended per-endpoint with filters):
`page` (default `1`), `pageSize` (default `24`, max `100`). Used today by:

- `GET /api/v1/influencers` (`Paginated<InfluencerSummaryDTO>`)
- `GET /api/v1/campaigns` (`Paginated<CampaignSummaryDTO>`)

### Cursor (feeds)

```ts
interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
```

Query params (`cursorQuerySchema`, extended per-endpoint with filters):
`cursor` (opaque, from the previous page's `nextCursor`), `limit` (default
`24`, max `100`; individual endpoints tighten this — e.g. notifications default
`20`/max `50`, activity default `25`/max `50`). Implemented today as literal
`CursorPage<T>` responses on:

- `GET /api/v1/content/feed` — Live Content
- `GET /api/v1/notifications`
- `GET /api/v1/activity`

`GET /api/v1/whats-new` is conceptually the same class of feed (and is grouped
with these in `pagination.ts`'s own comment), but is currently returned as a
bounded array (`WhatsNewItemDTO[]`) embedded in the dashboard aggregation
rather than as an independent `CursorPage`.

## DTO philosophy

`packages/contracts` never exposes Prisma models over the wire. Every response
is an explicit, hand-shaped DTO (`packages/contracts/src/dto/index.ts`), which
is what lets the contract stay stable while the database schema evolves
underneath it. Two things this buys, called out directly in the code:

- **Provenance, not silent nulls**: externally-sourced fields (follower counts,
  metrics) carry a `ProvenanceDTO` (`{ source: DataSource, updatedAt, updatedByName? }`)
  so a client can show "N/A" / a data-source badge instead of fabricating a
  zero.
- **Media represented independently, for mobile**: published content never
  ships raw provider HTML. `PublishedContentDTO.embed` is a strictly-typed,
  origin-allowlisted `EmbedDescriptor` (from `@influenceos/shared`), plus
  separate `thumbnailUrl`/`embeddable` fields — so a mobile client can render
  the same content natively (e.g. a native video/image view) instead of
  needing a web view, while the web app renders the identical DTO through
  `SocialContentPlayer`.

## Mobile SDK generation path

There is no mobile app in this repo yet, but the path is deliberate and already
in place:

1. Every route's request/response shape comes from Zod schemas
   (`packages/contracts`), which `apps/api` also uses for runtime validation —
   so the OpenAPI doc it generates is never hand-maintained or out of sync.
2. `GET /api/openapi.json` exposes that generated document.
3. `@influenceos/api-client` (`packages/api-client`) is a thin, dependency-free
   `fetch` wrapper — typed per-endpoint methods returning the shared DTOs,
   `Authorization: Bearer` support via a sync-or-async `TokenProvider`, and the
   same `ApiError` shape everywhere. `apps/web` is its only consumer today.
4. A future iOS/Android client is expected to either generate a native SDK from
   `/api/openapi.json`, or consume `@influenceos/api-client` directly (e.g. from
   React Native) — either way against the exact same `/api/v1` contract, with no
   separate mobile-only backend.

The Feature Registry (`packages/contracts/src/registry/features.ts`) tracks,
per feature, whether this is actually true today via `mobileReady: boolean` —
true only when business logic is server-side, the endpoint is documented,
auth/permissions are enforced server-side, contracts are stable, media is
independent of the web UI, and pagination is server-side. See
`docs/MOBILE_READINESS.md` / `docs/FEATURE_MATRIX.md`, both generated from this
same list.

## Endpoint reference

Grouped as in the OpenAPI tags / Feature Registry modules. `:id` accepts either
a cuid or, where noted, a slug. Unless noted **(public)**, every endpoint
requires `Authorization: Bearer <accessToken>`; **(admin)** additionally
requires `role === 'ADMIN'`.

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Log in with email + password. **(public)** |
| POST | `/api/v1/auth/refresh` | Exchange a refresh token for a new pair. **(public)** |
| POST | `/api/v1/auth/logout` | Revoke the current session. **(public — token in body)** |
| GET | `/api/v1/auth/me` | Current authenticated user. |
| GET | `/api/v1/auth/sessions` | List active device sessions. |
| DELETE | `/api/v1/auth/sessions/:id` | Revoke a device session. |
| GET | `/api/v1/users` | List users. **(admin)** |
| POST | `/api/v1/users` | Create a staff/admin user. **(admin)** |

### Brands

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/brands` | List brands, for the brand switcher and management (`?includeInactive`). |
| POST | `/api/v1/brands` | Create a brand. **(admin)** |
| GET | `/api/v1/brands/:idOrSlug` | Get a brand by id or slug. |
| PATCH | `/api/v1/brands/:id` | Update a brand. **(admin)** |
| GET | `/api/v1/brands/:idOrSlug/dashboard` | Brand-scoped Mission Control dashboard. |

### Influencers

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/influencers` | List/filter the influencer directory. Offset-paginated. |
| POST | `/api/v1/influencers` | Create an influencer → `201`. |
| GET | `/api/v1/influencers/:id` | Influencer 360 profile. |
| PATCH | `/api/v1/influencers/:id` | Update an influencer. |
| POST | `/api/v1/influencers/resolve` | Resolve a pasted profile URL/handle (official provider data or manual fallback). |
| GET | `/api/v1/influencers/:id/social-accounts` | Social accounts for an influencer. |
| GET | `/api/v1/influencers/:id/followers` | Follower growth time series. |
| GET | `/api/v1/influencers/:id/audience-health` | Audience health signals. |
| GET | `/api/v1/influencers/:id/notes` | Internal notes for an influencer. |
| GET | `/api/v1/influencers/:id/brands` | Brand relationships for an influencer. |
| POST | `/api/v1/notes` | Add an internal note (on an influencer and/or brand). |
| PATCH | `/api/v1/notes/:id` | Update a note (`body`, `pinned`). |
| DELETE | `/api/v1/notes/:id` | Delete a note. |
| POST | `/api/v1/brand-influencers` | Create or update a brand ↔ influencer relationship. |
| DELETE | `/api/v1/brand-influencers/:id` | Remove a brand ↔ influencer relationship. |

### Social Accounts

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/influencers/:id/social-accounts` | Add a social account to an influencer → `201`. |
| PATCH | `/api/v1/social-accounts/:id` | Update a social account. |
| POST | `/api/v1/social-accounts/:id/sync` | Sync a social account via its platform adapter. |
| DELETE | `/api/v1/social-accounts/:id` | Remove a social account. |

### Campaigns

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns` | List/filter campaigns. Offset-paginated. |
| POST | `/api/v1/campaigns` | Create a campaign. |
| GET | `/api/v1/campaigns/:idOrSlug` | Get a campaign by id or slug. |
| PATCH | `/api/v1/campaigns/:id` | Update a campaign. |
| GET | `/api/v1/campaigns/:id/influencers` | Influencers on a campaign. |
| POST | `/api/v1/campaigns/:id/influencers` | Add an influencer to a campaign. |
| GET | `/api/v1/campaign-influencers/:id` | Campaign-influencer detail. |
| PATCH | `/api/v1/campaign-influencers/:id` | Update a campaign influencer (deal, status, notes). |
| DELETE | `/api/v1/campaign-influencers/:id` | Remove an influencer from a campaign. |

### Deliverables

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/campaign-influencers/:id/deliverables` | Add a deliverable to a campaign influencer. |
| PATCH | `/api/v1/deliverables/:id` | Update a deliverable. |
| DELETE | `/api/v1/deliverables/:id` | Remove a deliverable. |

### Scripts

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns/:id/scripts` | Scripts for a campaign. |
| GET | `/api/v1/scripts/:id` | Script detail with version history. |
| POST | `/api/v1/scripts` | Create a script reference (with its first version). |
| POST | `/api/v1/scripts/:id/versions` | Add a new version to a script reference. |

### Content

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/content/feed` | Live Content feed — cursor-paginated, media-independent DTOs. |
| POST | `/api/v1/content` | Add published content by URL (auto-detects platform, links a deliverable) → `201`. |
| GET | `/api/v1/content/:id` | Content detail + embed descriptor. |
| PATCH | `/api/v1/content/:id` | Update content (caption, associations, manual status). |
| GET | `/api/v1/content/:id/metrics` | Metric snapshot history. |
| POST | `/api/v1/content/:id/metrics` | Add manual metrics (platforms without an official API). |
| GET | `/api/v1/content/:id/monitoring` | Content availability monitoring events. |
| POST | `/api/v1/content/:id/refresh` | Refresh availability + metrics via the platform adapter. |

### Costs

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns/:id/costs` | Expenses + cost summary for a campaign. |
| POST | `/api/v1/campaigns/:id/expenses` | Add an expense to a campaign. |
| PATCH | `/api/v1/expenses/:id` | Update a campaign expense. |
| DELETE | `/api/v1/expenses/:id` | Delete a campaign expense. |

### Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/dashboard/global` | Global Mission Control aggregation, optionally `?brandId=` scoped. |
| GET | `/api/v1/dashboard/attention` | Items needing attention, optionally brand-scoped. |
| GET | `/api/v1/whats-new` | What's New feed, optionally brand-scoped. |

### Calendar

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/calendar` | Unified calendar feed — campaign dates, deliverables, expected/actual publishes. Required `from`/`to`, optional `brandId`/`campaignId`/`influencerId`/`platform`. |

### Reports

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/reports` | Generate an analytics report. `type=campaign\|influencer\|brand\|content\|spend`, `format=json\|csv` (`format=csv` streams a `text/csv` download instead of JSON). |

### Notifications

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/notifications` | List notifications for the current actor. Cursor-paginated; `?unreadOnly=`. |
| GET | `/api/v1/notifications/unread-count` | Unread notification count → `{ count }`. |
| POST | `/api/v1/notifications/read` | Mark notifications read, by `ids[]` or `all: true` → `{ updated }`. |

### Activity

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/activity` | Chronological activity feed, optionally scoped to a brand/campaign/influencer. Cursor-paginated. |

### Search

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/search` | Global search across influencers, campaigns, brands, and content. Required `q`, optional `brandId`, `limit` (default 8, max 20). |

### Integrations

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/integrations` | List integration settings for all platforms. |
| GET | `/api/v1/integrations/capabilities` | Live provider capability snapshot for all platforms. |
| PATCH | `/api/v1/integrations/:platform` | Update an integration's settings/credentials. **(admin)** |
| POST | `/api/v1/integrations/:platform/test` | Run a live connectivity test for an integration. **(admin)** |

### Platform & API

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/platform/features` | Feature Registry, verbatim. |
| GET | `/api/v1/platform/modules` | Per-module rollup of the Feature Registry. |
| GET | `/api/v1/platform/status` | Live platform status: versions, DB health, mobile-readiness coverage. |
| GET | `/api/v1/platform/endpoints` | Flattened API endpoint list with derived auth level. |
| GET | `/api/v1/platform/flags` | All feature flags, platform + brand-scoped. **(admin)** |
| PATCH | `/api/v1/platform/flags/:key` | Toggle a platform-wide feature flag. **(admin)** |
| GET | `/api/v1/platform/app-versions` | Mobile app version/rollout rules for iOS + Android. **(admin)** |
| PATCH | `/api/v1/platform/app-versions/:platform` | Upsert version/rollout rules for one mobile platform (`IOS`\|`ANDROID`). **(admin)** |
| PATCH | `/api/v1/platform/client-config` | Update the client-config singleton (maintenance mode, upload limits, etc). **(admin)** |

### Client Config

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/client-config` | Public, client-safe remote config for web/mobile bootstrap. **(public — no auth required)** |

`ClientConfigDTO` (`packages/contracts/src/client-config.ts`) carries
`apiVersion`, `environment`, `maintenanceMode` + `maintenanceMessage`,
`defaultLanguage`/`supportedLanguages`, `enabledFeatures`/`disabledFeatures`,
upload limits (`upload.maxUploadMb`, accepted MIME types), the public provider
capability matrix, per-platform mobile app version rules (`app.ios`/`app.android`),
and `supportInfo` — everything a client needs to bootstrap before the user logs
in.

## curl examples

Log in and capture the access token:

```bash
curl -sS -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme"}'
```

```json
{
  "user": { "id": "...", "email": "admin@example.com", "name": "Admin", "role": "ADMIN", "avatarUrl": null, "locale": "en", "theme": "system" },
  "tokens": { "accessToken": "eyJ...", "refreshToken": "...", "accessTokenExpiresAt": "...", "refreshTokenExpiresAt": "...", "tokenType": "Bearer" }
}
```

Use the access token for an authenticated request:

```bash
TOKEN="eyJ..."   # tokens.accessToken from the login response

curl -sS http://localhost:4000/api/v1/brands \
  -H "Authorization: Bearer $TOKEN"
```

A failing request returns the standardized error envelope, e.g. requesting a
protected route with no token:

```bash
curl -sS http://localhost:4000/api/v1/brands
```

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required.", "requestId": "req_ab12cd34ef" } }
```
