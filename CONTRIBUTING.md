# Contributing to InfluenceOS

Welcome. InfluenceOS is a **platform API with multiple clients** (web today, mobile in the
future), not a web app with an API bolted on. That framing drives almost every rule in this
document — read the golden rule below before writing any code.

- Architecture deep-dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Database schema/conventions: [`docs/DATABASE.md`](docs/DATABASE.md)
- Security model: [`docs/SECURITY.md`](docs/SECURITY.md)
- Feature/mobile-readiness matrices: [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md),
  [`docs/MOBILE_READINESS.md`](docs/MOBILE_READINESS.md)

## Getting set up

Follow the [README Quick start](README.md#quick-start) to bring up Postgres/Redis/MinIO via
`docker compose`, install with `pnpm install`, migrate + seed the database, and run
`pnpm dev` (api on `:4000`, web on `:3000`, worker on `:4100`). Node `>=20` is required
(`.nvmrc` pins `22`, matching CI); package manager is `pnpm@10.33.0` via Corepack.

## The golden rule: API-first

> **Every capability the web app offers must exist as a versioned API operation.** The web
> app is a *client*, exactly like a future iOS/Android app will be.

Concretely, this means:

- **Business logic lives in `packages/domain`, nowhere else.** All validation beyond input
  shape, all state transitions, all side effects (activity logging, notifications,
  progress calculations) happen in a `make<X>Service(ctx)` factory in
  `packages/domain/src/services/*.service.ts`. Domain services return explicit **DTOs**
  (from `packages/contracts`), never raw Prisma models.
- **`apps/api` is a thin transport layer.** Fastify routes parse/validate with Zod, resolve
  the actor, call exactly one domain service method, and return its DTO. If you find
  yourself writing an `if` that decides *what happens*, not just *what's allowed*, inside a
  route handler — move it to `packages/domain`.
- **`apps/web` never touches Prisma or `packages/domain` for product functionality.** It
  imports only `@influenceos/api-client` (plus `@influenceos/contracts` for shared
  types/enums and `@influenceos/shared` for browser-safe pure helpers). No hidden
  server-only logic lives in a Next.js Server Action or Route Handler that a mobile client
  couldn't also reach by calling the API.
- **The worker (`apps/worker`) reuses the same domain services** the API calls (e.g.
  `content.refresh`) so scheduled jobs, manual "refresh" buttons, and any future client
  produce identical results — never a second implementation of the same rule.

If a PR adds a web page or worker job that *can't* be explained as "calls this API
endpoint, which calls this domain service," that's a sign the logic is in the wrong layer.

## Where things live

| Package/app | Responsibility | Depends on |
|---|---|---|
| `packages/shared` | Browser-safe: social provider adapters + capability matrix, URL/embed parsing, pure metric calculations, audience-health signals, formatting. No Prisma, no framework. | — |
| `packages/contracts` | The API contract: Zod request/filter schemas, response **DTOs** (never Prisma models), standardized error + pagination envelopes, client-safe enums, and the code-level **Feature Registry**. | `shared` |
| `packages/database` | Prisma schema (`prisma/schema.prisma`), migrations, client singleton, seed script. | — |
| `packages/domain` | **All business rules**, as `make<X>Service(ctx)` factories: auth, brands, influencers, social accounts, campaigns, deliverables, scripts, content + monitoring, costs, dashboard aggregation, reports, search, calendar, integrations, platform. | `database`, `contracts`, `shared` |
| `packages/api-client` | Strongly-typed fetch SDK — the single client used by web today and a future mobile app. | `contracts` |
| `apps/api` | Fastify HTTP layer under `/api/v1`, Zod validation, OpenAPI generation, auth, error mapping. | `domain`, `contracts`, `database`, `shared` |
| `apps/web` | Next.js 15 App Router client. Consumes `@influenceos/api-client` only. | `api-client`, `contracts`, `shared` |
| `apps/worker` | BullMQ queues (`content-check`, `follower-sync`, `maintenance`) that call domain services directly. | `domain`, `contracts`, `database` |

## Conventions

- **TypeScript strict, no `any`.** `tsconfig.base.json` sets `strict: true`,
  `noUncheckedIndexedAccess: true`, and `noImplicitOverride: true` for every package. Don't
  add `any`, `as any`, or `@ts-ignore` — if a Prisma payload's shape is awkward, write a
  small structural interface (see `packages/domain/src/lib/mappers.ts`) and let TypeScript
  narrow it.
- **Zod validates at the API edge only.** Request bodies/query strings are Zod schemas from
  `packages/contracts/src/requests` (e.g. `requests.publishedContentCreateSchema`), wired
  onto Fastify routes via `fastify-type-provider-zod`. Domain services trust their typed
  inputs (`z.infer<typeof someSchema>`) — they don't re-validate.
- **Service factory pattern.** Every domain module exports `make<X>Service(ctx: DomainContext)`
  returning an object of async functions, and a `type XService = ReturnType<typeof make<X>Service>`.
  `DomainContext` (`packages/domain/src/context.ts`) carries `prisma`, the authenticated
  `actor` (or `null` for the worker/seed via `systemContext()`), provider `credentials`, and
  an optional `requestId`. `apps/api/src/http.ts`'s `servicesFor(request)` builds this
  per-request via `createServices(createContext(...))`; never reach for a global Prisma
  client from inside a service.
- **DTO mappers.** `packages/domain/src/lib/mappers.ts` holds `to<X>DTO`/`to<X>Summary`
  functions that turn Prisma rows into contract DTOs, accepting narrow structural input
  types rather than full Prisma types. Add a new mapper here rather than inlining DTO shape
  logic inside a service.
- **Activity logging + notifications.** Use the shared helpers in
  `packages/domain/src/lib/helpers.ts` for any user-visible state change:
  `logActivity(ctx, { type, message, ...links })` writes an `ActivityLog` row, and
  `createNotification(ctx, { category, title, ...links })` creates a `Notification` (with an
  `IN_APP` delivery row). Call both where relevant — see `content.service.ts`'s `create()`
  for the pattern (log the activity, then notify).
- **Authorization helpers.** `requireActor(ctx)` (from `packages/domain/src/lib/authz.ts`)
  throws `AppError.unauthorized()` for mutations that need any signed-in user; `requireAdmin(ctx)`
  throws `AppError.forbidden()` for admin-only operations. Throw `AppError` (with its static
  helpers `.notFound()`, `.conflict()`, `.badRequest()`, `.validation()`, etc.) from domain
  code — never a bare `Error` — so the API's error handler can map it to the standardized
  `{ error: { code, message, requestId, ... } }` envelope.
- **Formatting.** `pnpm format` runs Prettier (single quotes, semicolons, trailing commas,
  100-char width, Tailwind class sorting via `prettier-plugin-tailwindcss`).

## Adding a feature end-to-end

Use this order — each step depends on the last, and it mirrors how existing features
(e.g. Published Content) are built:

1. **Schema.** Add/modify a model in `packages/database/prisma/schema.prisma`, following the
   conventions in [`docs/DATABASE.md`](docs/DATABASE.md) (cuid IDs, `Decimal(14,2)` for
   money, nullable metric fields — never fabricated zeros, indexed FKs/filters).
2. **Migration.** `pnpm db:migrate` (wraps `prisma migrate dev` for `@influenceos/database`)
   to generate and apply a dev migration; `pnpm db:generate` regenerates the Prisma client.
3. **DTO + request schema in `packages/contracts`.** Add the response DTO under
   `packages/contracts/src/dto`, and any request/filter Zod schema under
   `packages/contracts/src/requests` (e.g. a new `*CreateSchema`/`*UpdateSchema`/`*FilterSchema`).
4. **Domain service in `packages/domain`.** Add or extend a `make<X>Service(ctx)` in
   `packages/domain/src/services`, using mappers for DTO shaping and the activity/notification
   helpers for side effects. Wire it into `createServices()` in `packages/domain/src/index.ts`.
5. **API route in `apps/api`.** Add a route file under `apps/api/src/routes` (or extend an
   existing one), registered in `apps/api/src/routes/index.ts`. Attach the Zod schema to
   `schema.body`/`querystring`/`params`, set `preHandler: [requireAuth]` (or `requireAdmin`),
   and call exactly one `servicesFor(req).<service>.<method>(...)`.
6. **`api-client` method.** Add the typed call in `packages/api-client/src/index.ts` under
   the relevant namespace, using `In<typeof requests.someSchema>` for the body type and the
   contract DTO for the response type.
7. **Web page.** Build the page/component under `apps/web/src/app/(app)/...`, calling the
   new `api-client` method (`getServerApi()` in Server Components,
   `api` from `apps/web/src/lib/api-browser.ts` + TanStack Query in Client Components) — never
   Prisma or `packages/domain` directly.
8. **Register in the Feature Registry.** Add or update the feature's entry in
   `packages/contracts/src/registry/features.ts` (`FEATURES` array): `apiEndpoints`,
   `apiStatus`/`webStatus`, `classification` (`SHARED` vs `ADMIN_DESKTOP_ONLY`), and an
   honest `mobileReady` boolean per the criteria documented at the top of that file.
9. **`pnpm docs:generate`.** Regenerates `docs/FEATURE_MATRIX.md`, `docs/MOBILE_READINESS.md`
   and `docs/SOCIAL_PROVIDER_MATRIX.md` from the Feature Registry / capability matrix so the
   docs never drift from code. Commit the regenerated files.

## Running checks

```bash
pnpm typecheck   # turbo run typecheck — tsc --noEmit across every package/app
pnpm lint        # turbo run lint — web uses `next lint`; other packages currently no-op
pnpm test        # turbo run test — vitest (packages/apps that have tests; --passWithNoTests elsewhere)
pnpm build       # turbo run build — full monorepo build (Next.js build + tsc for others)
```

Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR. CI
(`.github/workflows/ci.yml`) runs, in order: install (`--frozen-lockfile`), `pnpm db:generate`,
`pnpm db:deploy`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, a seed smoke test
(`pnpm db:seed`), then `pnpm build`, against real Postgres and Redis services — reproduce
locally with `docker compose up -d` if a check fails only in CI.

## Commit / PR expectations

- Keep commits scoped and use a `type: summary` subject in the style already in history
  (`feat: …`, `chore: …`, `fix: …`).
- A PR that adds or changes a capability should touch every layer in the "adding a feature"
  list it needs — a route with no domain service, or a web page with no API backing it, will
  be asked to be restructured per the golden rule above.
- If you touched `packages/contracts/src/registry/features.ts` or
  `packages/shared/src/providers/capability-matrix.ts`, run `pnpm docs:generate` and commit
  the regenerated `docs/*.md` — don't hand-edit the generated sections.
- Call out any schema change (new model/field/migration) explicitly in the PR description so
  reviewers can check it against [`docs/DATABASE.md`](docs/DATABASE.md)'s conventions.

## Definition of Done

A change is done when:

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all pass.
- [ ] Business logic lives in `packages/domain` and returns DTOs; `apps/api` routes are thin;
      `apps/web` uses only `@influenceos/api-client`.
- [ ] New/changed endpoints have Zod request schemas, a `requireAuth`/`requireAdmin`
      `preHandler`, and appear in Swagger UI (`/api/docs`) via the route's `schema`.
- [ ] User-visible state changes call `logActivity` and, where relevant, `createNotification`.
- [ ] Errors are thrown as `AppError` (never a bare `Error`/leaked DB error).
- [ ] Schema changes have a Prisma migration and follow `docs/DATABASE.md` conventions
      (cuid IDs, `Decimal` money, nullable metrics, indexed filters).
- [ ] **Mobile-readiness is honest.** If the feature is a normal product capability
      (not an internal admin/technical screen), it is entered in the Feature Registry
      (`packages/contracts/src/registry/features.ts`) as `classification: 'SHARED'` with
      `mobileReady: true` **only if** it genuinely meets every criterion in
      `docs/MOBILE_READINESS.md`'s "Definition of Mobile Ready": server-side business logic,
      a documented API endpoint, server-enforced auth/permissions, stable request/response
      contracts, media represented independently of the web UI, server-side
      filtering/pagination, API test coverage, and no web-only server behavior. Genuinely
      admin/desktop-only features are marked `ADMIN_DESKTOP_ONLY` with `mobileReady: false`
      and a documented reason — never silently left out of the registry.
- [ ] `pnpm docs:generate` has been run and its output committed if the Feature Registry or
      provider capability matrix changed.
