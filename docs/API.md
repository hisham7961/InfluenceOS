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
- `GET /api/v1/campaigns` (`Paginated<CampaignSummaryDTO>`; newest first, or `sort=startDate|endDate|name` with `order`)

### Cursor (feeds)

```ts
interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  pagination?: OffsetPagination; // only when `page` was sent
}
```

Query params (`cursorQuerySchema`, extended per-endpoint with filters):
`cursor` (opaque, from the previous page's `nextCursor`), `limit` (default
`24`, max `100`; individual endpoints tighten this — e.g. notifications default
`20`/max `50`, activity default `25`/max `50`). Implemented today as literal
`CursorPage<T>` responses on:

- `GET /api/v1/content/feed` — Live Content (newest first by publish date,
  or by when it was found if the publish date is unknown)
- `GET /api/v1/notifications`
- `GET /api/v1/activity` (limited to the caller's brands)
- `GET /api/v1/shipments`
- `GET /api/v1/platform/audit`
- `GET /api/v1/influencers/:id/timeline`

**Numbered pages.** Every one of these also accepts `page` (1-based) instead
of `cursor`; `limit` is then the page size and the response carries
`pagination: { page, pageSize, total, totalPages }` (`hasMore` is true until
the last page, `nextCursor` is null). The web app uses numbered pages
everywhere; cursor paging stays for clients that stream.

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
| GET | `/api/v1/influencers` | List/filter the influencer directory. Offset-paginated. Filters: `q`, `platform`, `relationshipStatus`, `countryCode`, `city`, `category`, `minFollowers`/`maxFollowers` (any account), `ownerId` (a user id, or `unowned`), `tag`, `brandId`, `campaignId` the Data Quality deep links (`missingCountry`, `missingOwner`, `missingPhone`, `missingSocial`), and (P3.7) `audienceCountry` + `audienceMinPct` (default 1; the account's newest audience insights, on `platform` when set), `minEngagementRate`/`maxEngagementRate` (an account's last recorded engagement rate), `language` (a code — ar, en, fr…; matches the usual spellings in the profile), `gender`, and `minRate`/`maxRate` + `rateCurrency` (default KWD; the creator's usual fee per post overlaps the range). Sort: `sort=createdAt\|name\|updatedAt` with `order=asc\|desc` (newest first by default); the CSV export takes the same. |
| POST | `/api/v1/influencers` | Create an influencer → `201`. |
| GET | `/api/v1/influencers/:id` | Influencer 360 profile. |
| PATCH | `/api/v1/influencers/:id` | Update an influencer. Also takes `gender` and the usual fee per post `rateMin`/`rateMax` + `rateCurrency` (P3.7; from ≤ to, a currency once there's an amount → `400` otherwise). |
| POST | `/api/v1/influencers/resolve` | Resolve a pasted profile URL/handle (official provider data or manual fallback). |
| POST | `/api/v1/influencers/:id/contact-log` | Log a message sent outside the app (`channel`, `purpose`, optional `campaignInfluencerId`) → `204`. Shows on the creator's timeline and "last contact"; the first one on a roster row fills its contacted date. |
| GET | `/api/v1/influencers/:id/social-accounts` | Social accounts for an influencer. |
| GET | `/api/v1/influencers/:id/followers` | Follower growth time series. |
| GET | `/api/v1/influencers/:id/audience-health` | Audience health signals. |
| GET | `/api/v1/influencers/:id/audience` | Audience insights for the creator's accounts, newest first; `isLatest` marks the one per account the filters use (P3.7). |
| POST | `/api/v1/social-accounts/:id/audience` | Add audience insights: `capturedAt` (not in the future), `countries` [{`countryCode`, `pct`}] (≤10, no repeats), `femalePct`/`malePct`, five age groups, `engagementRate`, `attachmentId` (the screenshot — one of the creator's files), `notes`. Each group of shares must add up to ≤ 100 (0.5 slack for rounding) → `422` otherwise. The newest per account also sets the account's engagement rate. |
| PATCH | `/api/v1/audience/:id` | Correct audience insights (same fields; `countries` replaces the list). |
| DELETE | `/api/v1/audience/:id` | Remove audience insights → `204`; the one before it becomes the latest. |
| GET | `/api/v1/influencers/:id/notes` | Internal notes for an influencer. |
| GET | `/api/v1/influencers/:id/brands` | Brand relationships for an influencer. |
| GET | `/api/v1/influencers/:id/performance` | A creator's results over time: posts (all / last 90 days), median views and engagement, brands that booked again, on-time rate, paid and cost per view (money with finance access only), per platform. |
| POST | `/api/v1/notes` | Add an internal note (on an influencer, a brand, and/or a piece of content). |
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
| GET | `/api/v1/campaigns` | List/filter campaigns. Offset-paginated. Filters: `q`, `brandId`, `status`, `objective`, `ownerId` ("my campaigns"), `ownerMissing`. Sort: `sort=createdAt\|startDate\|endDate\|name` with `order=asc\|desc`. |
| POST | `/api/v1/campaigns` | Create a campaign. |
| GET | `/api/v1/campaigns/:idOrSlug` | Get a campaign by id or slug. |
| PATCH | `/api/v1/campaigns/:id` | Update a campaign. `draftReview: true` puts every deliverable (not only UGC) through a draft review before posting. Targets for the client report: `targetViews`, `targetEngagements`, `targetEngagementRate` (percent), `targetCostPerView` (campaign currency), plus a free-text `reportSummary` (all nullable; also accepted on create). |
| GET | `/api/v1/campaigns/:idOrSlug/report` | The client report: results against the targets, per creator and per post (best first). `?locale=en\|ar` picks the language of the labels the clients print (default: the caller's own); `?costs=false` leaves spend and cost per view out. Costs are always left out for a caller without the `FINANCE_VIEW` capability (`includeCosts` says which applied). Another brand's user gets 404. |
| GET | `/api/v1/campaigns/:idOrSlug/report/xlsx` | The same report as an Excel workbook (Summary, Creators, Posts sheets; right-to-left in Arabic). Same `locale` / `costs` query and the same access rules. |
| GET | `/api/v1/campaigns/:id/report-shares` | The report's no-login links (`CAMPAIGNS_MANAGE`): `path` (`/share/r/<token>` on the web app), `locale`, `includeCosts`, `expiresAt`, `revokedAt`, `active`, `viewCount`, `lastViewedAt`, who made it. |
| POST | `/api/v1/campaigns/:id/report-shares` | Share the report by link: `locale` (`en` default / `ar`), `includeCosts` (default `false`; `true` needs `FINANCE_VIEW`, else 403), `expiresInDays` (1–365, default 30; `null` = no end date). Only a SHA-256 of the token finds the link; the token is kept encrypted so the link can be copied again. Logged in the campaign's activity. |
| POST | `/api/v1/report-shares/:id/revoke` | Turn a link off (it stops working at once; can't be turned back on). |
| GET | `/api/v1/public/reports/:token` | **Public.** The report for a link, built from live numbers in the link's language and with costs only if the link includes them. 404 for an unknown, expired or turned-off link. Counts a visit unless the visitor is a link preview/script or `preview=1`. `Cache-Control: private, no-store`; rate limit 60/min per IP. |
| GET | `/api/v1/public/reports/:token/xlsx` | **Public.** The same as an Excel workbook (not counted as a visit). |

**Creator task links (P3.3).** A creator's part of one campaign without an
account. Making and turning off links needs `CAMPAIGNS_MANAGE` or
`INFLUENCERS_MANAGE`, with brand and country scope. The public endpoints only
ever read or change that creator's own deliverables on that campaign, and
record their actions without a team member as the actor. A link stops working
when it is turned off, expires, the creator is declined/dropped, or the
campaign is cancelled (404).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaign-influencers/:id/creator-links` | A roster row's task links: `path` (`/share/c/<token>`), `locale`, `expiresAt`, `revokedAt`, `active`, `openCount`, `lastOpenedAt`, who made it. |
| POST | `/api/v1/campaign-influencers/:id/creator-links` | `locale` (`ar` default / `en`), `expiresInDays` (1–365, default 90; `null` = no end date). Only a SHA-256 of the token finds the link; the token is stored encrypted. |
| POST | `/api/v1/creator-links/:id/revoke` | Turn a link off. |
| GET | `/api/v1/public/creator/:token` | **Public.** The creator's page: campaign name, brand, dates, brief, `draftReview`; each deliverable with due date, requirements, hashtags/mentions, status, the brand-approved script version (without internal comments), drafts (version, status, link, caption, note, `fromCreator`, the team's decision note as `feedback`), the post link they sent, and `canSendDraft` / `canSendPost`. Never fees, internal notes, team comments or other creators. Counts a visit unless a link preview/script or `preview=1`. Rate limit 60/min. |
| POST | `/api/v1/public/creator/:token/deliverables/:deliverableId/uploads` | **Public.** `fileName`, `mimeType`, `sizeBytes`. Starts uploading the draft file itself: only a photo or a video (JPEG, PNG, WebP, GIF, MP4, MOV, WebM) up to `MAX_UPLOAD_MB`, only on this creator's own task that can take a draft. Returns an upload ticket (presigned PUT straight to storage, or the link's own upload address below), valid 1 hour and usable only with this link and task. 422 for another type or too big. |
| PUT | `/api/v1/public/creator/:token/uploads?ticket=` | **Public.** The file's bytes (octet-stream) when storage can't take them directly; checked against the ticket's size and link. |
| POST | `/api/v1/public/creator/:token/deliverables/:deliverableId/drafts` | **Public.** `assetUrl` (http/https) **or** `uploadToken` (from the upload above), `caption`, `notes`. An uploaded file becomes an attachment of the deliverable and the draft's file (`fileName` on the creator's page; the team sees it on the draft); one upload makes one draft. Creates the next draft version in review (`fromCreator: true`), moves the deliverable to in review, logs it and notifies the team. 409 while a draft is still in review or when the task is approved/finished; 404 for another creator's deliverable. Rate limit 20/min. |
| POST | `/api/v1/public/creator/:token/deliverables/:deliverableId/posted` | **Public.** `url` (http/https). Saved on the deliverable as `creatorPostUrl` / `creatorPostedAt` for the team to check and add as content; it never counts as published by itself. Notifies the team. |

Drafts carry `fromCreator` in `DeliverableSubmissionDTO`; deliverables carry
`creatorPostUrl` and `creatorPostedAt`.

**Saved post covers.** The cover links Instagram and TikTok give out expire
after a few days. Each sweep the worker copies up to `COVER_BATCH_SIZE` covers
(default 30; 0 = off) into private storage under `covers/` — only from the
platforms' image hosts (https, each redirect re-checked), only real images
(checked by their bytes), at most 3 MB, with a timeout; an expired link is
looked up again from the post once, and a cover that can't be saved is tried
at most 3 times. Posts then show `GET /api/v1/covers/:id?e=…&s=…`: a signed
link that stays the same all day (so browsers cache it), works for at least a
day, needs no login (so shared client reports show covers too) and opens only
that one post's cover. Deleting the post deletes its saved cover.

**Post discovery (P3.4).** While a campaign is active the worker reads the
roster creators' newest posts where the configured keys allow it (Instagram
Business Discovery for Professional accounts, YouTube uploads playlist, X user
timeline) — each account at most every 6 hours, `MONITOR_DISCOVERY_BATCH_SIZE`
accounts per sweep (default 20; 0 = off) — and suggests posts whose caption has
the creator's promo code, the deliverables' hashtags/mentions, the brand's name,
or an ad disclosure (#ad/#إعلان, only with a single running campaign), posted
from 2 days before the campaign to 3 days after it.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns/:id/discovered-posts` | `?status=NEW` (default) / `ADDED` / `DISMISSED`: the suggestions with creator, platform, link, caption, posted date, `signals` (`code:…`, `hashtag:#…`, `mention:@…`, `brand`, `disclosure`) and the suggested deliverable. Needs `CONTENT_VIEW`; brand/country scope. |
| POST | `/api/v1/campaigns/:id/discover-posts` | Read the campaign's creators' accounts now (skips accounts read in the last 5 minutes). Returns `checked`, `found`, `recent`, and `unavailable` accounts with the reason (`NO_CREDENTIAL`, `ACCOUNT_NOT_ELIGIBLE`, `NOT_SUPPORTED_BY_PLATFORM`, `RATE_LIMITED`…). Needs `CONTENT_MANAGE`; 6/min. |
| POST | `/api/v1/discovered-posts/:id/add` | Track the post as the campaign's content (same rules as `POST /content`); `deliverableId` overrides the suggestion (`null` = none; must be this creator's on this campaign). If it was added by hand meanwhile, the suggestion links to that content. 409 once decided. |
| POST | `/api/v1/discovered-posts/:id/dismiss` | Not campaign content: never suggested again. |

Checks follow the post's age (see BUSINESS_RULES.md "Checking posts");
`PublishedContentDTO.nextCheckAt` says when the next one is due.

**Creator licences (P3.5).** A creator's advertising licence per country; a
campaign's `marketCountryCodes` (on create/update and in `CampaignDetailDTO`)
say which countries it is for. See BUSINESS_RULES.md "Creator licences".

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/influencers/:id/licences` | The creator's licences: `countryCode`, `authority`, `number`, `issuedAt`, `expiresAt`, `status` (`VALID` / `EXPIRING_SOON` within 30 days / `EXPIRED`), `daysLeft`, `document` (open with `GET /files/:id`). Needs `INFLUENCERS_VIEW`; country and brand scope. |
| POST | `/api/v1/influencers/:id/licences` | Record one: `countryCode` (required), `authority`, `number`, `issuedAt`, `expiresAt`, `attachmentId` (must be one of this creator's files), `notes`. One per creator and country (409). Needs `INFLUENCERS_MANAGE`. |
| PATCH | `/api/v1/licences/:id` | Change it (a renewal: new number or end date — a new end date re-arms the expiry reminder). |
| DELETE | `/api/v1/licences/:id` | Remove it. |
| GET | `/api/v1/campaigns/:id/licences` | The roster (invited, confirmed, in progress) against the campaign's countries that need a licence: per creator and country `VALID` / `MISSING` / `EXPIRED` / `EXPIRES_DURING`, and `ok`. Needs `CAMPAIGNS_VIEW`; brand scope, creators outside the viewer's countries left out. |
| GET | `/api/v1/compliance/settings` | `licenceCountryCodes`: the countries where creators need a licence (default KW, SA, AE). |
| PUT | `/api/v1/compliance/settings` | Admin only: set that list. |

**Caption check (P3.5).**

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/deliverables/:id/caption-rules` | What the caption must carry: `hashtags` and `mentions` (the deliverable's plus the approved script version's, with `#`/`@`, once each) and `disclosureRequired` (paid or gifted work the creator posts — not FREE deals, not UGC). Check a caption with `checkCaption()` from `@influenceos/shared`. Same scope as the deliverable's drafts. |

Each task on the creator's link (`CreatorTaskDTO`) carries the same
`captionRules`. Needs Attention gains `DISCLOSURE_MISSING`: one per active
campaign with live paid/gifted posts whose caption doesn't say it's an ad
(`params.count`).

Needs Attention gains `CREATOR_LICENCE` (one per planning/active/paused
campaign; `params.missing` / `params.expiring` count confirmed creators), and
notifications gain `LICENCE_EXPIRING`.
| GET | `/api/v1/campaigns/:id/influencers` | Influencers on a campaign. Each row carries `results`: posts live / total / planned, latest views and engagements, engagement rate, and the creator's own spend (fee + expenses recorded against them, gift purchases excluded) with cost per view and per engagement. |
| GET | `/api/v1/campaigns/:idOrSlug/efficiency` | Campaign spend efficiency (CPV/CPM/CPE), metric freshness and sources, `perContent` (each post's estimated CPV from its own creator's spend) and `perCreator` (the roster's `results` side by side). |
| POST | `/api/v1/campaigns/:id/influencers` | Add an influencer to a campaign. |
| GET | `/api/v1/campaigns/:id/candidates/suggestions` | Suggested creators for the campaign's sourcing list (P3.7): active, in-scope creators not on its roster or sourcing list and not ruled out (blacklisted, or declined/blacklisted by this brand), ranked by a match score out of 100 from plain rules — audience in the campaign's countries (newest insights, up to 35), based there (15), worked with the brand (15 + up to 5), engagement ≥3% / ≥5% (10 / 15), on the campaign's platforms (10) — each returned as `reasons`. `limit` 1–30 (default 12). Add one with `POST /campaigns/:id/candidates` and the score as `fitScore`. |
| GET | `/api/v1/campaign-influencers/:id` | Campaign-influencer detail. |
| PATCH | `/api/v1/campaign-influencers/:id` | Update a campaign influencer (deal, status, notes). |
| DELETE | `/api/v1/campaign-influencers/:id` | Remove an influencer from a campaign. |

### Deliverables

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/campaign-influencers/:id/deliverables` | Add a deliverable to a campaign influencer (`requiresProduct` flags gifting-dependent deliverables). |
| PATCH | `/api/v1/deliverables/:id` | Update a deliverable. |
| DELETE | `/api/v1/deliverables/:id` | Remove a deliverable. |
| GET | `/api/v1/deliverables/:id/submissions` | Submissions filed against a deliverable. |
| POST | `/api/v1/deliverables/:id/submissions` | Submit a draft for review → `201`: `attachmentId` (a file uploaded to this deliverable via `POST /files` with `target.deliverableId`), `caption`, `assetUrl`, `notes` (all optional: an empty one records a draft shared outside the app). Approving completes UGC without any public URL; any other type is then cleared to post (`APPROVED`, no `publishedAt`) and is delivered once the post is live. Rows carry `caption` and `attachment` (with a short-lived download link). |
| GET | `/api/v1/submissions/:id` | Submission detail. |
| POST | `/api/v1/submissions/:id/review` | Review a submission (approve / request changes / reject). |
| POST | `/api/v1/submissions/:id/comments` | Add a threaded review comment → `201`. |
| GET | `/api/v1/campaigns/:id/submissions` | All submissions across a campaign's roster. |

### Logistics (shipments)

Evolved from a single shipment per campaign participation (W3-5) into a full
fulfilment workflow: a campaign influencer may have several shipments (one
per deliverable that needs a product, plus general/replacement shipments),
each with its own product line items and optional deliverable link. Recipient
PII (phone/address/delivery instructions) is redacted server-side for the
`VIEWER` role.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaign-influencers/:id/shipments` | Shipments for one campaign participation. |
| POST | `/api/v1/campaign-influencers/:id/shipments` | Create a shipment (optionally linked to a deliverable, with product line items) → `201`. |
| GET | `/api/v1/campaigns/:id/shipments` | Product shipments across a campaign roster. |
| GET | `/api/v1/shipments` | Cross-campaign logistics workspace — filter by status/brand/campaign, cursor-paginated. |
| GET | `/api/v1/shipments/:id` | Shipment detail with line items. |
| PATCH | `/api/v1/shipments/:id` | Update fulfilment details (address, courier, tracking, notes). |
| POST | `/api/v1/shipments/:id/status` | Advance shipment status (auto-stamps `shippedAt`/`deliveredAt`; syncs activity + notification). |

### Scripts

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns/:id/scripts` | Scripts for a campaign. |
| GET | `/api/v1/scripts/:id` | Script detail with version history. |
| POST | `/api/v1/scripts` | Create a script reference (with its first version). |
| POST | `/api/v1/scripts/:id/versions` | Add a new version to a script reference. |
| POST | `/api/v1/scripts/:id/versions/:version/status` | Brand approval of one version: `{ status: DRAFT \| SENT_TO_BRAND \| CHANGES_REQUESTED \| APPROVED, note? }`. The approved version becomes the script's `approvedVersion` (the one creators follow); moving it off `APPROVED` clears that. Versions carry `status`, `reviewedByName`, `reviewedAt`, `reviewNote`. |

### Files

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/files` | Start a two-phase signed upload for one target: `campaignId`, `deliverableId`, `scriptReferenceId`, `influencerId`, `noteId`, `publishedContentId` or `campaignInfluencerId` (a roster row: that creator's agreement and paperwork for the campaign). |
| PUT | `/api/v1/files/blob?token=…` | Local-driver upload proxy (S3 uploads go straight to the presigned URL). |
| POST | `/api/v1/files/complete` | Confirm the upload and create the record (idempotent). |
| GET | `/api/v1/files?<target>=<id>` | Files on a target. Same brand and country scope as the target itself: another brand's campaign, deliverable, script, post or roster row, or a creator outside the user's countries → `404`. |
| GET | `/api/v1/files/:id` | One file (same scope rule). |
| DELETE | `/api/v1/files/:id` | Remove a file (uploader or admin). |

### Content

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/content/feed` | Live Content feed — cursor-paginated, media-independent DTOs. |
| POST | `/api/v1/content` | Add published content by URL (auto-detects platform, links a deliverable) → `201`. |
| POST | `/api/v1/content/lookup` | Check a pasted post link before adding it: follows TikTok/Instagram share links, says whether the post is already tracked (any link to the same post), names the creator from the handle in the link, and lists their deliverables still waiting for a post. Writes nothing. |
| POST | `/api/v1/campaigns/:id/content/link-roster` | Link every post by the campaign's roster that isn't in any campaign yet (and isn't tied to another brand) → `{ linked, skipped }`. Posts in other campaigns are left alone. |
| GET | `/api/v1/content/:id` | Content detail + embed descriptor. |
| PATCH | `/api/v1/content/:id` | Update content (caption, associations, manual status). |
| GET | `/api/v1/content/:id/metrics` | Metric snapshot history. |
| POST | `/api/v1/content/:id/metrics` | Add manual metrics (platforms without an official API). |
| POST | `/api/v1/content/:id/metrics/read-screenshot` | AI (P3.2): read a post's numbers from one of its attached insights screenshots — `{ attachmentId, locale }` (PNG/JPEG/WebP/GIF ≤ 5 MB, attached to this post). Returns suggested `values` (views, likes, comments, shares, saves; null when not shown), `capturedOn` (only when the screen shows it), `looksLikeInsights`, a `note` in the reader's language and `remaining` requests this month. Nothing is saved. Needs CONTENT_MANAGE, scope, and AI turned on (409 when off, a feature is off or the month's limit is used). |
| GET | `/api/v1/content/:id/monitoring` | Content availability monitoring events. |
| POST | `/api/v1/content/:id/refresh` | Refresh availability + metrics via the platform adapter. |
| GET | `/api/v1/content/summary` | Content Command Center — per-user New/Seen/Reviewed/Review-Later/Unassigned/Alert counts, a daily summary and a per-brand breakdown, all in one call. |
| PATCH | `/api/v1/content/:id/view-state` | Mark seen / reviewed / review-later for the calling user only (`UserContentState`). |
| GET | `/api/v1/content/:id/notes` | Internal notes on this content (reuses the Note model). |

### Costs

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns/:id/costs` | Expenses + cost summary for a campaign. Needs `FINANCE_VIEW` (403 without it). Deleted expenses are left out. |
| POST | `/api/v1/campaigns/:id/expenses` | Add an expense to a campaign. A `paymentStatus` of paid / part paid records a payment in the ledger. |
| PATCH | `/api/v1/expenses/:id` | Update a campaign expense. Payment fields go through the ledger: a higher paid total records a payment for the difference; a lower one is refused (409) — void a payment instead. |
| DELETE | `/api/v1/expenses/:id` | Move an expense to the campaign's deleted expenses (restorable). Refused (409) while it has live payments. |
| GET | `/api/v1/campaigns/:id/expenses/trash` | The campaign's deleted expenses, newest first (`FINANCE_VIEW`). |
| POST | `/api/v1/expenses/:id/restore` | Restore a deleted expense (`FINANCE_MANAGE`). |

### Finance (payment ledger)

Payments are the record of what was paid. A roster row's (creator fee) or an
expense's `paymentStatus`, `paidAmount` and `paidAt` are derived from its live
(not voided) payments. Reading needs `FINANCE_VIEW`; recording and voiding need
`FINANCE_MANAGE`. Everything stays inside the caller's brand scope.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/finance/payables` | Creator fees and expenses with money still owed, oldest due first, with the total owed per currency. Filters: `brandId`, `campaignId`, `influencerId`, `q`, `kind` (`FEE` / `EXPENSE`), `page`, `pageSize`. |
| GET | `/api/v1/finance/payables/xlsx` | The same list as an Excel workbook (`locale=en\|ar`). |
| GET | `/api/v1/finance/payments` | The ledger, newest first, with the total paid per currency. Filters: `brandId`, `campaignId`, `influencerId`, `campaignInfluencerId`, `expenseId`, `from`, `to`, `q`, `includeVoided`. |
| GET | `/api/v1/finance/payments/xlsx` | The ledger as an Excel workbook (`locale=en\|ar`). |
| GET | `/api/v1/finance/payments/:id` | One payment. |
| POST | `/api/v1/campaign-influencers/:id/payments` | Record a payment against a creator's fee: `amount`, `paidAt`, `method` (`BANK_TRANSFER`, `CASH`, `CHEQUE`, `CARD`, `PAYMENT_LINK`, `OTHER`), optional `reference`, `notes`, `receiptAttachmentId` (a file already attached to this campaign). 409 when the fee is not payable or the amount is more than what is still owed. |
| POST | `/api/v1/expenses/:id/payments` | Record a payment against an expense (same body and rules). |
| POST | `/api/v1/payments/:id/void` | Void a payment (`reason` required). It stays in the history, marked voided, and stops counting as paid. |

A creator with payments recorded can't be removed from the roster (409) — set
their participation to dropped instead, so the payment history stays.

### Sales & ROI

Promo codes and tracking links per creator per campaign, and the brand's own
sales credited to them. Revenue is only what the brand's shop file or a person
recorded — nothing is estimated. Reading needs access to the campaign's brand;
changing anything needs `CAMPAIGNS_MANAGE`. Spend, fees, return on spend and
cost per order are `null` without `FINANCE_VIEW`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/campaigns/:id/sales` | Orders, revenue per currency, link clicks and conversion; per creator (codes, clicks, orders, revenue, and with finance access fee, ROAS, cost per order); the codes, links, 50 newest sales and the files that reached this campaign; `canManage`. ROAS = revenue in the campaign's currency ÷ spend. |
| POST | `/api/v1/campaigns/:id/promo-codes` | `influencerId` (on the roster), `code`, optional `discount`, `validFrom` (default: the campaign's start), `validTo`, `notes`. 409 when the code is already on this campaign or another creator has it for overlapping dates. |
| PATCH | `/api/v1/promo-codes/:id` | Change the code, discount, dates, notes, or `isActive` (an inactive code isn't matched in new imports). |
| DELETE | `/api/v1/promo-codes/:id` | Only a code with no sales (409 otherwise — turn it off instead). |
| POST | `/api/v1/campaigns/:id/tracking-links` | `influencerId`, `destinationUrl` (http/https), optional `label`, `utm` (default true: adds `utm_source` = the creator, `utm_medium=influencer`, `utm_campaign` = the campaign, `utm_content` = the link, keeping tags already in the URL). Returns `slug` and `path` (`/r/<slug>` on the web app). |
| PATCH | `/api/v1/tracking-links/:id` | `destinationUrl`, `label`, `isActive` (a paused link still redirects but stops counting). |
| DELETE | `/api/v1/tracking-links/:id` | The short link stops working; sales already credited stay. |
| POST | `/api/v1/campaigns/:id/sales` | Sales entered by hand (e.g. a total the brand reported): `influencerId`, optional `promoCodeId`, `orders`, `amount`, `currency` (default: the campaign's), `occurredAt`, `note`. |
| DELETE | `/api/v1/sales/:id` | Delete one recorded sale. |
| POST | `/api/v1/brands/:id/sales/import` | A shop's order file for a brand, as rows of raw cells (`orderRef`, `date`, `amount`, `currency`, `code`, `link`, `orders`, `status`; up to 20,000; body up to 8 MB), with `dateOrder` (`DMY` default / `MDY`), a fallback `currency`, `fileName`, and `dryRun`. Each row is credited by promo code (the code whose dates cover the order; the one that started last when a code was reused) or by one of the brand's tracking links in a link/UTM cell. Arabic-Indic digits, Gulf currency names (`د.ك`, `KD`, …), day-first dates and Excel date numbers are read; cancelled/refunded rows are left out; an order number already on record for the brand, or repeated in the file, is skipped. Returns counts (matched, duplicates, unmatched, outside the code's dates, cancelled), unreadable rows with their line and problem, codes not set up for the brand, and per-campaign totals. With `dryRun: false` the orders are saved as one file (`importId`). |
| DELETE | `/api/v1/sales-imports/:id` | Undo a file: removes every order it recorded, on every campaign. Returns `{ removed }`. |
| GET | `/api/v1/public/links/:slug` | **Public.** Where a tracking link goes (`{ url }`); counts the click per Kuwait day unless the visitor is a link preview/script, the link is paused, or `preview=1`. The web app's `/r/<slug>` calls it and redirects (302). 404 for an unknown link. Rate limit 120/min per IP. |

`GET /api/v1/influencers/:id/performance` also returns `sales`: orders, revenue
per currency and link clicks credited to the creator across the brands the
reader can see (`null` when none). The client report (`GET
/api/v1/campaigns/:id/report` and its `.xlsx`) has a `sales` section — orders,
revenue, link clicks, and ROAS / cost per order only when costs are included —
plus each creator's orders and revenue; `null` when nothing is recorded. The
owner dashboard's period results (`GET /api/v1/reports/exec-dashboard`) carry
`orders` and `revenue` for the period and the one before, by order date.

### Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/dashboard/global` | Global Mission Control aggregation, optionally `?brandId=` scoped. |
| GET | `/api/v1/dashboard/attention` | Items needing attention, optionally brand-scoped. |
| GET | `/api/v1/whats-new` | What's New feed, optionally brand-scoped. |
| POST | `/api/v1/dashboard/whats-new/ack` | Advance the calling user's own "since your last visit" checkpoint — never a GET side effect. |

### My work and approvals (P3.6)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/me/work` | What's waiting on the caller: drafts to review, overdue and due-soon (3 days) deliverables on what they own, shipments and open address issues assigned to them, and found posts on their campaigns. `ownsAnything` is false when they own no campaign or creator yet. Each list is capped at 50. |
| GET | `/api/v1/me/work/counts` | Sidebar badges — `{ myWork, approvals }`. |
| GET | `/api/v1/approvals` | Drafts waiting for review across every campaign in the caller's scope, oldest first (max 200). `?mine=true` keeps the caller's own; each row says whether it's `mine`. Reviewing uses the existing submission routes. |

### Calendar

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/calendar` | Unified calendar feed — campaign dates, deliverables, expected/actual publishes. Required `from`/`to`, optional `brandId`/`campaignId`/`influencerId`/`platform`. Each event carries `campaignName`, `influencerName` and `deliverableType` so a client can word the title in its own language (`title` is English). |

### Reports

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/reports` | Generate an analytics report. `type=campaign\|influencer\|brand\|content\|spend`, `format=json\|csv` (`format=csv` streams a `text/csv` download instead of JSON). |
| GET | `/api/v1/reports/exec-dashboard` | The owner's dashboard. `period=month\|quarter\|year\|last30\|custom` (+ `from`/`to` as `YYYY-MM-DD`, Kuwait days) and `brandId`: results for the period against the same number of days before it, spend vs budget per currency, today, since yesterday, brands. Cached 60 s per reader. |
| GET | `/api/v1/reports/trends` | Week- or month-by-month results: `bucket=week\|month`, optional `brandId`, `campaignId`, `influencerId`, `from`/`to` (default: the last 12 buckets). Paid amounts only with finance access. |
| GET | `/api/v1/reports/benchmarks` | Rate benchmarks (P3.7) from confirmed/in-progress/completed paid bookings with an agreed fee: `feePerPost` (fee ÷ posts planned, else posts made, else 1), `costPerView` (fee ÷ views on their posts for that campaign) and `engagementRate` (engagements ÷ views), each as median + middle half (`p25`/`p75`) + `sampleSize`, null below 3 bookings. `overall` is narrowed by `platform` + `tier` (NANO/MICRO/MID/MACRO/MEGA), or resolved from `influencerId` (their main account now) or `campaignInfluencerId` (its platform and size when booked; that booking is left out); `grid` has every platform × tier with a booking. Also `countryCode` (the creator's), `brandId`, `currency` (default KWD; no conversion — `otherCurrencies` counts the rest), `months` (3/6/12/24, 0 = all time; default 12). Brand and country scope apply; fee and cost figures are null without finance access (`moneyVisible: false`). |
| GET | `/api/v1/reports/leaderboard` | Creators ranked by results and reliability (median views, on-time rate), not volume alone. |

### Notifications

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/notifications` | List notifications for the current actor. Cursor-paginated; `?unreadOnly=`. |
| GET | `/api/v1/notifications/unread-count` | Unread notification count → `{ count }`. |
| POST | `/api/v1/notifications/read` | Mark notifications read, by `ids[]` or `all: true` → `{ updated }`. |
| GET | `/api/v1/notifications/settings` | Your email settings → `NotificationSettingsDTO` (`digestFrequency` DAILY/WEEKLY/OFF, `emailCategories`, `emailConfigured`, `email`, `lastDigestAt`). |
| PATCH | `/api/v1/notifications/settings` | Change `digestFrequency` and/or `emailCategories` (notification kinds also emailed as they happen). |
| GET | `/api/v1/notifications/digest-preview` | What your summary email would hold now → `DigestDTO` (overdue, due soon, drafts to review, posts taken down in 24h, usage rights expiring; money owed with finance access). Scoped to your brands/countries; narrowed to campaigns/creators you own when you own any. |
| POST | `/api/v1/notifications/test-email` | Send yourself a test email → `{ sentTo }`; 409 when email isn't set up (no `SMTP_URL`) or one was sent in the last minute. |

Read state is per person (P2.6): a notification addressed to you carries its
own `isRead`; a team-wide one (no recipient) is read for you once you mark it,
without changing it for anyone else. Team-wide notifications are listed only
when you can see their brand and their creator's country. Reminder links go
to the relevant tab (`/campaigns/:id?tab=deliverables`); every link the server
hands out is checked against the web app's pages by a test
(`packages/shared/src/__tests__/app-routes.test.ts`).

### Activity

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/activity` | Chronological activity feed, optionally scoped to a brand/campaign/influencer. Cursor-paginated. |

### Search

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/search` | Global search across influencers, campaigns, brands, and content. Required `q`, optional `brandId`, `limit` (default 8, max 20). |
| GET | `/api/v1/search/page` | The full search page (P3.7): also matches creators' full names, tags and notes, brands' notes, and post captions/links; ranked by how and where it matched (`matchedOn`). Required `q`; optional `types` (one or more of `influencer`, `campaign`, `brand`, `published_content`), `page`, `pageSize` (max 50), `brandId`. `counts` gives the matches per type whatever `types` asks for; up to 60 per type are ranked, and `truncated` says a narrower query would find more. Deleted notes never match; posts follow their creator's country scope (so does `/search`). |

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
| GET | `/api/v1/platform/ai` | AI settings (P3.2): switch, model and where it comes from, key source and last four characters (never the key), monthly limit, feature switches, this month's use by feature. **(admin)** |
| PATCH | `/api/v1/platform/ai` | Change them: `enabled`, `model` (null clears), `apiKey` (stored encrypted; null removes), `monthlyLimit`, `readScreenshots`, `writingHelp`. Turning AI on without a key and a model is refused (422). **(admin)** |
| GET | `/api/v1/ai/status` | For everyone: whether AI is available, which features are on, and requests left this month. |
| POST | `/api/v1/campaigns/:id/scripts/ai-draft` | AI writing help (P3.5): a first draft of a script version — `{ scriptId?, deliverableId?, instructions?, language }`. Uses the campaign brief, the deliverable's requirements and (for `scriptId`) the script's current text and brand feedback; the deliverable's required hashtags and mentions are always kept. Returns body, caption suggestion, talking points, dos/don'ts, hashtags, mentions. Nothing is saved. Needs CAMPAIGNS_MANAGE and scope. |
| POST | `/api/v1/submissions/:id/ai-review` | AI writing help: suggested review notes on a creator's draft — `{ language }`. Uses the brief, the approved script, the caption check (returned as `caption`) and the draft's caption, notes and image (videos and links aren't opened). Returns `summary`, `notes`, `looksReady`. Needs UGC_REVIEW and scope. |
| POST | `/api/v1/campaigns/:id/report/ai-summary` | AI writing help: a short summary for the client report — `{ language }` — from the same figures the reader's report shows (no costs without FINANCE_VIEW). Not saved: put it in `reportSummary` with `PATCH /campaigns/:id`. Needs CAMPAIGNS_MANAGE and scope. |

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
