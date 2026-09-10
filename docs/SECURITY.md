# Security

This document describes the security model actually implemented in InfluenceOS: how
users authenticate, how the web client transports tokens, how authorization is
enforced, the HTTP hardening baseline, embed security (spec §38), input validation,
the error contract, secrets handling, and provider-compliance posture. It is written
against the current code — nothing here is aspirational unless explicitly marked as
"not yet implemented."

## 1. Authentication

Implemented in `packages/domain/src/services/auth.service.ts` (`makeAuthService`),
wired into HTTP by `apps/api/src/http.ts` and `apps/api/src/routes/auth.routes.ts`.

### Password hashing

- `hashPassword()` hashes with **Argon2id** via `@node-rs/argon2` (`argonHash` /
  `argonVerify`, both memory-hard, tunable KDF). Only `passwordHash` is stored on
  `User` (`packages/database/prisma/schema.prisma`) — plaintext passwords never
  touch the database.
- `login()` calls `argonVerify(user.passwordHash, input.password)` and swallows any
  verification error into a generic `Invalid email or password.` (`AppError`,
  code `UNAUTHORIZED`) so failure responses don't distinguish "no such user" from
  "wrong password."
- Registration (`createUser`, admin-only) requires `password` to be 8–200 chars
  (`registerUserSchema` in `packages/contracts/src/requests/index.ts`); login only
  requires 1–200 chars (existing-password check, not a strength check).

### JWTs: short-lived access token + rotating refresh token

Both are signed HS256 with `jose`, using a single server secret (`AUTH_SECRET`,
`secret()` in `auth.service.ts`, min 16 chars — the process throws `AppError`
`INTERNAL` if it's missing/short).

| Token | Claims | TTL | Purpose |
|---|---|---|---|
| **Access** | `sub` = user id, `role`, `name`, `typ: 'access'` | 15 min (`ACCESS_TTL_SEC`) | Sent as `Authorization: Bearer` on every API call; verified statelessly, no DB hit. |
| **Refresh** | `sub` = user id, `sid` = `DeviceSession.id`, `typ: 'refresh'` | 7 days by default, overridable via `AUTH_SESSION_TTL` env var (`refreshTtlSec()`) | Exchanged at `POST /api/v1/auth/refresh` for a new token pair. |

Both are minted together by `issueTokens()`, which also **rotates** the refresh
token: on every login and every refresh, `DeviceSession.refreshTokenHash` is
overwritten with `sha256(newRefreshToken)` and `lastActiveAt` is bumped. The raw
refresh token is never persisted — only its SHA-256 hash. Every refresh token
carries a unique `jti`, so each rotation is a distinct token (and hash) even
when two are minted within the same second.

**Reuse detection & family revocation.** A refresh token is single-use. Because
the JWT signature proves the server minted it, any correctly-signed refresh
token presented for an active session whose hash matches *neither* the current
token *nor* the grace-window predecessor must be a previously-rotated token
being replayed — the classic sign of theft. `refresh()` responds by revoking the
entire session (`revokedAt` + `revokedReason: 'refresh_token_reuse_detected'`),
invalidating the attacker's and the victim's tokens alike and forcing a fresh
login. A short grace window (`AUTH_REFRESH_GRACE_MS`, default 30s) honours the
previous token (`prevRefreshTokenHash` + `refreshRotatedAt`) so genuinely
concurrent refreshes from one client are not mistaken for reuse. This is covered
by the integration suite (`apps/api/test/integration/auth.test.ts`): rotation,
reuse → family revoke, forged-token rejection, logout, and concurrent-refresh
grace.

### DeviceSession: per-device sessions and revocation

Each login creates a `DeviceSession` row (`client: WEB | IOS | ANDROID | API`,
`deviceId`, `deviceName`, `appVersion`, `userAgent`, `ip`, `expiresAt`,
`revokedAt`). This gives per-device session tracking and revocation without making
access-token verification stateful:

- `GET /api/v1/auth/sessions` — list the caller's active (`revokedAt: null`)
  sessions (`requireAuth`).
- `DELETE /api/v1/auth/sessions/:id` — revoke one, after confirming the session
  belongs to the caller (`requireAuth`).
- `POST /api/v1/auth/logout` — revokes the session named by the refresh token's
  `sid` claim if one is supplied, else best-effort revokes the caller's most
  recently active session.
- `refresh()` checks `session.revokedAt` and `session.expiresAt` before issuing new
  tokens, so a revoked or expired session cannot mint further access tokens even
  with a structurally valid, unexpired refresh JWT.
- By design, `refresh()` does **not** hard-revoke a session on a refresh-token hash
  mismatch (concurrent refreshes from the same browser would otherwise log the user
  out); revocation is deliberately only driven by explicit logout, admin/user
  session revocation, or expiry (see the comment in `auth.service.ts`).

### Stateless `authenticate()`

`authenticate(token)` (`auth.service.ts`) verifies the JWT signature/expiry and
`typ === 'access'`, and returns an `Actor { id, name, role }` built entirely from
the token's claims — **no database read**. This is invoked on every request:

```ts
// apps/api/src/app.ts
app.addHook('onRequest', async (request) => {
  request.actor = null;
  try {
    request.actor = await resolveActor(request);   // apps/api/src/http.ts
  } catch {
    request.actor = null;
  }
});
```

`resolveActor()` (`apps/api/src/http.ts`) pulls the token from `Authorization:
Bearer …` or an `access_token` cookie, then calls `services.auth.authenticate()`
using a `systemContext()` (no actor bound yet — this is the bootstrap call that
*produces* the actor). A missing/invalid/expired token simply leaves
`request.actor === null`; route guards (§3) turn that into a 401/403.

## 2. Web token transport (BFF) vs. mobile

### Web: tokens never reach browser JavaScript

`apps/web` uses a **backend-for-frontend** pattern (`apps/web/src/lib/session.ts`):
access and refresh tokens are stored **only** in `httpOnly`, `sameSite: 'lax'`
cookies on the Next.js origin (`io_at`, `io_rt`; `secure` in production). No
client-side JS ever reads or holds the raw tokens.

| Cookie | Purpose | Max-Age |
|---|---|---|
| `io_at` | Access token | 15 min (kept fresh by middleware) |
| `io_rt` | Refresh token | 7 days |

Flow:

1. **Login** — `POST /api/session/login` (`apps/web/src/app/api/session/login/route.ts`)
   calls the API's `/auth/login` server-side with `credentials: 'omit'`, then writes
   both tokens into httpOnly cookies via `writeAuthCookies()`. The browser only ever
   sees the `Set-Cookie` response, never the token values.
2. **Server Components** read the access cookie directly (`getAccessToken()`) and
   call the API server-side.
3. **Client components** never call the API directly — they call the same-origin
   proxy `POST/GET/PATCH/PUT/DELETE /api/bff/[...path]`
   (`apps/web/src/app/api/bff/[...path]/route.ts`), which:
   - forwards the request to `INTERNAL_API_URL` with `Authorization: Bearer
     <io_at cookie>` injected server-side,
   - on a `401`, transparently calls `/auth/refresh` with the `io_rt` cookie,
     rewrites both cookies (`writeAuthCookies`), and retries the request once,
   - is explicitly documented as a "thin transport proxy — NO business logic."
4. **`middleware.ts`** runs on every non-API page request: if there's no access
   cookie but there is a refresh cookie, it calls `/auth/refresh` itself, rewrites
   both cookies on the response, and lets the request through; if refresh fails it
   clears both cookies and redirects to `/login`. If neither cookie is present it
   redirects unauthenticated requests to `/login?next=...` and bounces an already-
   authenticated user away from `/login`.
5. **Logout** — `POST /api/session/logout` revokes the session server-side (best
   effort) and clears both cookies.

### Mobile: keychain + direct API calls (no BFF)

The doc comments in `session.ts` and `ARCHITECTURE.md` are explicit that this BFF
layer is **web-only**. A native mobile client is expected to call the API
(`apps/api`, `/api/v1/...`) directly, holding the access/refresh tokens in the
OS keychain instead of cookies, and attaching `Authorization: Bearer <token>` itself.
`packages/api-client` (`HttpCore` in `packages/api-client/src/core.ts`) is built for
exactly this: it accepts a `TokenProvider` (a string or async getter) and sends it
as `Authorization: Bearer`, with `credentials: 'include'` only defaulted on for the
web use case. The same client, same `/api/v1` contract, and same `AuthTokensDTO`
shape serve both transports — there's one API, not a web-specific and mobile-specific
backend.

## 3. Authorization

Two roles only, defined once (`UserRole` enum, `packages/database/prisma/schema.prisma`):

- **`ADMIN`**
- **`STAFF`** (default for new users)

Enforcement happens at **two layers**, both server-side (the web app has no
authorization logic of its own — it can't, since it holds no business logic):

1. **HTTP layer** — Fastify `preHandler`s in `apps/api/src/http.ts`:
   - `requireAuth(request)` — throws a 401 (`UNAUTHORIZED`) if `request.actor` is
     `null`.
   - `requireAdmin(request)` — calls `requireAuth` then throws a 403 (`FORBIDDEN`)
     unless `request.actor.role === 'ADMIN'`.
   Every route file under `apps/api/src/routes/*.ts` declares one of these in its
   route options; there is no route that skips both except `/health`,
   `/api/openapi.json`, `/api/docs`, and the public auth endpoints
   (`login`/`refresh`/`logout`).
2. **Domain layer** — `packages/domain/src/lib/authz.ts` provides `requireActor()`
   and `requireAdmin()` against the `DomainContext`, called *inside* service
   functions (e.g. `auth.service.ts`'s `listUsers`/`createUser` call
   `requireAdmin(ctx)`). This is defense-in-depth: even if a service were ever
   invoked from somewhere other than an HTTP route with the right `preHandler` (e.g.
   the worker, or a future internal caller), it still enforces the rule itself
   rather than trusting the transport layer.

Admin-gated surfaces (representative, via `requireAdmin`): user administration
(`GET/POST /users`), brand create/update, platform feature flags and app-version
rules, integration credential writes. Everything else that touches real data
requires at least `requireAuth`; there is no unauthenticated data endpoint besides
the public auth flows and `/health`.

## 4. Transport & HTTP hardening

Configured once in `apps/api/src/app.ts`:

| Concern | Mechanism |
|---|---|
| Security headers | `@fastify/helmet` (registered with `contentSecurityPolicy: false` on the API — CSP is enforced by the web app's own headers instead, since the API is a JSON service consumed by app clients, not rendered in a browser). |
| CORS | `@fastify/cors`, `origin: corsOrigins(env)` — an **explicit allowlist** parsed from the comma-separated `WEB_ORIGIN` env var (`apps/api/src/env.ts`), `credentials: true`, methods restricted to `GET, POST, PATCH, DELETE, OPTIONS`. |
| Rate limiting | `@fastify/rate-limit`, global default `300 requests / minute` per client, with `/health` allowlisted. `POST /auth/login` overrides this to a stricter `20 / minute` (`config.rateLimit` on the route) to slow down credential-stuffing/brute-force. Limit breaches surface as the standard error envelope with code `RATE_LIMITED` (HTTP 429). |
| Cookies | `@fastify/cookie` registered so the API can also read an `access_token`/`refresh_token` cookie as a fallback bearer source (`extractToken()` in `http.ts`), in addition to the `Authorization` header. |
| Logging hygiene | Fastify logger `redact: ['req.headers.authorization', 'req.headers.cookie']` — tokens never land in API logs. |
| `trustProxy: true` | So client IP (`req.ip`, recorded on `DeviceSession.ip`) and rate limiting are correct behind a reverse proxy/load balancer. |

### Web response headers & CSP (`apps/web/next.config.mjs`)

The Next.js app sets its own headers on every route (`headers()` in
`next.config.mjs`):

- `Content-Security-Policy` — `default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'self'`, and a **`frame-src` allowlist that is
  the same 5 origins as the embed allowlist** (see §5) — nothing else may be framed
  into the app.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: SAMEORIGIN` (belt-and-suspenders alongside `frame-ancestors`)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — these browser
  capabilities are hard-disabled; the app has no feature that needs them.

`script-src` currently includes `'unsafe-inline' 'unsafe-eval'` — the file's own
comment notes this is required by the Next.js dev/runtime, and `connect-src`
includes a broad `https:` plus the local API origin for development.

## 5. Embed security (spec §38)

`packages/shared/src/providers/embeds.ts` is the single place that turns a raw
provider content URL into something safe to render, and the rule it exists to
enforce is stated at the top of the file:

> We never render provider-supplied HTML.

The pipeline (`buildEmbed(url, platformHint?)`):

1. **Parse & classify** the URL: `detectPlatform(url)` → one of the known
   `Platform` enum values, or `null` (unknown platform → no embed).
2. **Normalize & extract a safe id**: `normalizeContentUrl()` / `parseContentId()`
   pull a `canonicalUrl` and a platform-specific `externalId` out of the URL — never
   out of any HTML/oEmbed payload the provider might return.
3. **Build a typed, whitelisted `iframeSrc`** by string-templating the *extracted
   id* into a fixed, hardcoded URL template per platform (YouTube's
   `youtube-nocookie.com/embed/{id}`, Instagram's `instagram.com/{p|reel|tv}/{id}/embed`,
   TikTok's `tiktok.com/embed/v2/{id}` — with a regex `^\d+$` guard so a
   non-numeric/short-link id falls back to link-only rather than being embedded —
   and X/Twitter's `platform.twitter.com/embed/Tweet.html?id={id}`). The id is
   always `encodeURIComponent`-escaped before interpolation.
4. **Attach the expected `allowedOrigin`** to the resulting `EmbedDescriptor`, and
   platforms with no safe embeddable form (Snapchat, or any platform where an id
   couldn't be extracted) get a `kind: 'link-only'` descriptor instead of an
   iframe — the UI can only render a link out to `canonicalUrl`, never a frame.
5. **`isAllowedIframeOrigin(src)`** independently re-validates any iframe `src`
   against the same allowlist by parsing it with `new URL()` and checking
   `origin` membership — a second gate that doesn't trust the descriptor alone.

### The allowlist — `IFRAME_ALLOWED_ORIGINS`

Exactly 5 origins are ever permitted as an embed iframe `src`, and these are the
**only** entries in the CSP `frame-src` directive (`next.config.mjs` keeps a
`FRAME_SRC` array with a comment pointing back at this file to keep the two in
sync):

1. `https://www.youtube-nocookie.com`
2. `https://www.youtube.com`
3. `https://www.instagram.com`
4. `https://www.tiktok.com`
5. `https://platform.twitter.com`

A related, narrower allowlist, `SCRIPT_ALLOWED_ORIGINS` (Instagram, X/Twitter,
TikTok), exists for official provider *embed scripts* (blockquote-style embeds),
kept separate from the iframe allowlist because it grants script execution rather
than a sandboxed frame.

Net effect: no user- or provider-supplied markup is ever injected into the page.
Every embed the app renders is either (a) an `<iframe>` whose `src` is a
first-party-constructed URL pointed at one of the 5 allowed origins, both allowed
by CSP `frame-src` and re-checked by `isAllowedIframeOrigin`, or (b) a plain link
to the canonical content URL.

## 6. Input validation

Validation is enforced **at the API boundary**, not trusted from the client:

- The API installs `fastify-type-provider-zod`'s `validatorCompiler` /
  `serializerCompiler` (`app.ts`), so every route's `schema.body` /
  `schema.params` / `schema.querystring` — all defined as Zod schemas in
  `packages/contracts/src/requests/index.ts` (`requests.loginSchema`,
  `registerUserSchema`, `campaignCreateSchema`, etc.) — is validated before the
  handler runs, and response DTOs are serialized through the same schemas
  (`serializerCompiler`), so handlers can't accidentally leak extra fields.
- A validation failure short-circuits into the standardized error contract (§7)
  with HTTP `422` and code `VALIDATION_ERROR`, carrying a `fieldErrors[]` array
  (`hasZodFastifySchemaValidationErrors` branch in the error handler) — never a
  raw AJV/Zod stack trace.
- The same Zod schemas double as the source for the generated OpenAPI spec
  (`jsonSchemaTransform`), so the documented contract and the enforced contract
  cannot drift apart.
- Server-side environment configuration is itself Zod-validated at boot
  (`apps/api/src/env.ts`'s `loadEnv()`) — an invalid/missing required env var
  (e.g. `DATABASE_URL`, `AUTH_SECRET`) prints the issues and calls
  `process.exit(1)` rather than starting with bad config.

## 7. Standardized error contract

Every error response — from the API — has the same shape
(`ApiErrorBody`, `packages/contracts/src/errors.ts`):

```json
{ "error": { "code": "FORBIDDEN", "message": "...", "requestId": "req_...", "fieldErrors": [ /* optional */ ] } }
```

`code` is one of a closed set (`API_ERROR_CODES`): `VALIDATION_ERROR`,
`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`RATE_LIMITED`, `MAINTENANCE`, `INTERNAL` — each mapped to a fixed HTTP status via
`HTTP_STATUS_FOR_CODE`. Domain code throws a typed `AppError` (`packages/domain/src/errors.ts`,
with `AppError.notFound/forbidden/unauthorized/conflict/badRequest/validation`
helpers) carrying one of these codes; the Fastify `setErrorHandler` in `app.ts`
converts it straight to the envelope.

Critically, **unhandled/unexpected errors never leak internals**: anything that
isn't an `AppError`, a Zod validation error, or a recognized `statusCode` falls
through to `request.log.error({ err, requestId }, 'Unhandled error')` — logged
server-side only — and the client gets a generic `{ code: 'INTERNAL', message:
'Something went wrong. Please try again.' }` with HTTP 500. No stack trace, SQL
error text, or Prisma error detail is ever serialized into a response. Every error
also carries the request's `requestId` (`genReqId: () => 'req_' + random`) so a
user-reported failure can be correlated with server logs without exposing anything
sensitive.

`packages/api-client`'s `ApiError` class mirrors this exact shape client-side
(`code`, `status`, `fieldErrors`, `requestId`), with an `isAuth` getter
(`code === 'UNAUTHORIZED'`) that both the web app and a future mobile client can
use to trigger a re-auth/refresh flow.

## 8. Secrets handling

- **Env-only, never in frontend code.** All secrets (`AUTH_SECRET`,
  `DATABASE_URL`, `S3_SECRET_ACCESS_KEY`, `YOUTUBE_API_KEY`,
  `X_API_BEARER_TOKEN`, `INSTAGRAM_APP_SECRET`, `TIKTOK_CLIENT_SECRET`,
  `SNAPCHAT_CLIENT_SECRET`, etc. — see `.env.example`) live in server-side
  environment variables read by `apps/api` and `apps/worker` only. None are
  prefixed `NEXT_PUBLIC_*`, and a repo-wide check shows `apps/web` consumes no
  `NEXT_PUBLIC_*` variables in its source — the web app has no build-time-inlined
  secret surface at all.
- **`.env` is git-ignored; `.env.example` documents shape, not values** — every
  secret in it ships as an empty string or an explicit placeholder
  (`"change-me-to-a-long-random-secret-value-please-rotate"` for `AUTH_SECRET`,
  with a one-liner to generate a real one via Node's `crypto.randomBytes`).
- **Client-safe vs. private config is a typed, explicit split.** `ClientConfigDTO`
  (`packages/contracts/src/client-config.ts`) is the *only* config shape ever
  returned to a client (`GET /api/v1/client-config`, backed by
  `platform.service.ts`), and its doc comment states plainly it **"NEVER contains
  secrets."** It exposes only operational/UX data — feature flags, supported
  languages, upload limits, provider *capability* booleans (not credentials), app
  version/force-update rules. Actual provider credentials
  (`INSTAGRAM_ACCESS_TOKEN`, API keys, etc.) are read directly from
  `process.env` inside domain/provider adapter code and never serialized into any
  DTO.
- **Optional-by-design provider credentials.** Every social-provider credential is
  optional; when absent, the corresponding adapter advertises reduced capabilities
  instead of failing (`.env.example`: *"The product works fully in manual-fallback
  mode without any of these"*) — so there's no incentive to over-provision or
  hardcode credentials to keep the app running.

### Seeding & first-admin bootstrap (production-safe)

The **demo seed** (`packages/database/prisma/seed.ts`) is destructive — it wipes
every table — so it is guarded hard (`guardDestructiveSeed()`):

- **Refuses** to run when `NODE_ENV=production`.
- **Opt-in only:** requires `SEED_DEMO=true`, so it can never run implicitly.
- **Refuses to clobber data:** if the target database already has users, it
  aborts unless `CONFIRM_WIPE=true`, and it echoes the exact `host:port/db` it
  would erase so you can't wipe the wrong database by accident.

For real environments there is a separate, **non-destructive, idempotent**
first-admin bootstrap (`prisma/bootstrap.ts`,
`pnpm --filter @influenceos/database bootstrap`): it creates one ADMIN **only if
no users exist**, with **no hardcoded password** — the email comes from
`BOOTSTRAP_ADMIN_EMAIL` and the password from `BOOTSTRAP_ADMIN_PASSWORD`, or a
strong random one is generated and printed once to be rotated on first login. It
is safe to run on every deploy.

### Repository hygiene

`.env` and `uploads/` are git-ignored; only `.env.example` (shape, no values) is
tracked. A scan of tracked files finds no AWS keys or private-key material. This
repository holds an organization's operational data model and should be kept
**private**, with branch protection on `main` (required CI + review). Repository
ownership and visibility are **not** changed by the tooling here — that is an
explicit human/admin decision.

## 9. File uploads & private object storage

Attachments ship as a **two-phase signed upload** over **private** object
storage. Nothing is ever served from a public bucket, and no permanent public
file URL is ever issued. Storage is abstracted behind two drivers
(`packages/domain/src/lib/storage.ts`), selected by `STORAGE_DRIVER`:

- **`s3`** — any S3-compatible store (MinIO in dev; S3/R2/etc. in prod). Uploads
  use presigned `PUT` URLs; downloads use presigned `GET` URLs
  (`ResponseContentDisposition` set). The bucket is created private and left
  private (the dev compose deliberately does **not** run `mc anonymous set`).
- **`local`** (default) — local disk under `LOCAL_UPLOAD_DIR`, with traversal
  guarding. Uploads and downloads go through signed API endpoints, never a
  static path.

**The flow** (`attachment.service.ts`, `apps/api/src/routes/files.routes.ts`):

1. `POST /api/v1/files` — validates the declared `mimeType` against a fixed
   server-side allowlist and `sizeBytes` against `MAX_UPLOAD_MB` (default 50),
   confirms the target record exists, sanitizes the filename, builds a
   collision-free storage key, and returns a **short-lived HMAC-signed upload
   ticket** (`jose`, `AUTH_SECRET`, 15-min TTL) plus a presigned `PUT` URL (S3)
   or a signed proxy path (local). **No DB row is created yet**, so an abandoned
   upload leaves no orphan record.
2. Client `PUT`s the bytes (direct to S3, or to the signed local proxy, which
   re-checks size).
3. `POST /api/v1/files/complete` — verifies the ticket, confirms the object
   landed with `HeadObject`/`stat`, re-checks the **actual stored size** against
   the limit (so a client can't under-declare then upload something larger), and
   only then creates the `Attachment` row.

**Downloads** never expose a public URL: `downloadUrl` is a presigned S3 `GET`
(absolute, expiring) or a signed local proxy link
(`GET /api/v1/files/:id/blob?token=…`, a 10-min HMAC capability that also works
in an `<img>`/`<a>` tag). Deletes remove the stored object then the row.

Defense-in-depth summary: private-by-default storage, server-side MIME allowlist
+ size ceiling (declared *and* actual), filename sanitization, path-safe
server-generated keys, expiring signed upload/download URLs, server-side
existence/authorization checks, and all errors routed through the standardized
contract (§7). Covered by `apps/api/test/integration/files.test.ts` (upload →
list → signed download → delete, MIME rejection, oversize rejection, unauthorized
rejection, and "no public URL" assertions).

## 10. Responsible data use / provider compliance

InfluenceOS's provider integrations are deliberately scoped to what each
platform's public/official surface allows (`.env.example`, `packages/shared/src/providers/`):

- **No scraping.** Every configured integration is an official API or embed
  mechanism: YouTube Data API v3 + oEmbed, X (Twitter) API v2 + oEmbed, Meta/
  Instagram Graph API (Professional accounts only) + oEmbed, TikTok
  display/embed only. Snapchat has no public profile API, so it is
  manual/URL-based by design rather than scraped — the platform's `buildEmbed()`
  gives it a `link-only` descriptor (§5), never a synthesized embed.
- **No re-hosting of provider content.** §5's embed pipeline never fetches,
  stores, or re-serves provider media or markup — it renders official iframes
  (`youtube-nocookie.com`, `instagram.com`, `tiktok.com`, `platform.twitter.com`)
  pointed at the provider's own canonical content, or a plain link to it. Metrics
  are fetched via each provider's official API/oEmbed response and stored as
  numeric snapshots (follower counts, engagement, etc.) — not as copies of the
  underlying content.
- **Honest capabilities, no silent degradation.** `PublicProviderCapabilityDTO`
  (`client-config.ts`: `contentEmbed`, `profileSync`, `enabled` per platform) is
  returned to clients so the UI can accurately represent what each platform
  supports today rather than implying uniform capability. The product is
  explicitly designed to run fully in "manual-fallback mode" with zero provider
  credentials configured, so there's never a need to fake data or bypass a
  provider's terms to keep a feature looking functional.

## 11. Production security review

A repo-wide review performed for production readiness. Each item lists what was
checked and the finding.

| Area | Check | Finding |
| --- | --- | --- |
| SQL injection | All DB access is Prisma; the only raw query (`auth.service.ts` row lock) is a tagged `$queryRaw` template, so `${sid}` is bound as a parameter, not interpolated. | **OK** — no string-built SQL. |
| XSS | No `dangerouslySetInnerHTML` anywhere in `apps/web`; React escapes by default; CSP is set (§4). | **OK.** |
| Code execution | No `eval`, `new Function`, or `child_process`/`exec` in application code. | **OK.** |
| Path traversal | Storage keys are server-generated (cuid-based); the local driver additionally strips `..` and leading slashes before joining under the upload dir (`storage.ts` `pathFor`). | **OK** (defence in depth). |
| Authorization | Every mutating/reading route declares `requireAuth`/`requireAdmin` except the intentionally public ones: `/auth/login`, `/auth/refresh`, `/auth/logout`, the capability-token file download `/files/:id/blob?token=…`, and the client-safe `/client-config`. | **OK** — public surface is minimal and deliberate. |
| SSRF | Provider adapters call fixed provider hosts (`googleapis.com`, `youtube.com/oembed`, etc.); user input is `encodeURIComponent`-ed into query strings, never used as the request host. | **OK** — no arbitrary-host fetch. |
| Secrets | gitleaks runs in CI (blocking); provider credentials are read server-side only and never reach the client bundle (verified against `.next/static`); provider secrets are AES-GCM envelope-encrypted at rest (§8). | **OK.** |
| Transport | httpOnly + `sameSite=lax` + `secure`-in-production cookies (§2); CSP, HSTS (prod), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (§4); only 80/443 exposed via the reverse proxy. | **OK.** |
| Abuse | Configurable rate limiting (Redis-backed option) with `/health`,`/ready`,`/metrics` allow-listed; per-IP login limit plus account-level time-boxed lockout (§1). | **OK.** |
| Error hygiene | The standardized error handler never leaks stack traces or DB errors; every response carries a correlatable `x-request-id` (§7). | **OK.** |
| Operational surface | `/metrics` is internal-only (never proxied publicly) and emits no secrets and only low-cardinality labels. | **OK.** |

### Residual items (accepted, tracked)

- **Dependency advisories.** The freeze-candidate upgrade (Next.js 15.5.25,
  @fastify/swagger-ui 6 → @fastify/static 10.1.3, fastify 5.12.3, postcss
  8.5.28, Playwright 1.56.1) took `pnpm audit --prod` from 4 critical / 17 high
  to **0 applicable critical / 0 applicable high**. Three moderate + one low
  remain, each verified **not reachable** in this app/topology: `next-intl`
  (we use only `next-intl/server`, not its routing middleware or the
  `experimental.messages.precompile` option), `uuid` (only vulnerable when a
  caller passes `buf`; we use `node:crypto`), and an `@smithy/config-resolver`
  low "defense-in-depth" note — all needing a major bump with no applicable
  code path. The CI `security` job still runs the audit in **report-only** mode
  so the residual advisories stay visible. Full classification in
  `docs/PRE_DEPLOYMENT_STATUS.md` §5.
- **CSP `unsafe-inline` / `unsafe-eval`.** The web CSP retains these for Next.js's
  runtime. Tightening to a nonce/hash-based policy is a follow-up; the production
  CSP already drops the dev-only `localhost`/websocket `connect-src` sources.

## Related docs

- `docs/ARCHITECTURE.md` — overall layering (API-first core, BFF, worker).
- `docs/PRODUCTION_ARCHITECTURE.md` — production topology, trust boundary, ports.
- `docs/PRODUCTION_READINESS.md` — the production-readiness matrix and blockers.
- `docs/MOBILE_READINESS.md` — how the mobile client is expected to consume the
  same `/api/v1` contract described in §2 here.
- `docs/SOCIAL_PROVIDER_MATRIX.md` — per-platform capability detail referenced by
  §5 and §10.
