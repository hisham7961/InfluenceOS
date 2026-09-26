# Build Status

Living status of the InfluenceOS implementation. Legend: ✅ done & verified ·
🟡 implemented, polish/edge-cases remain · ⛔ not started.

## Architecture & foundation
- ✅ pnpm + Turborepo monorepo; strict TypeScript; `.env.example`; Docker Compose
  (Postgres/Redis/MinIO); GitHub Actions CI.
- ✅ **API-first** layering: Fastify API → `packages/domain` services → Prisma. Web +
  worker are clients/consumers; web holds no business logic.
- ✅ Verified: API boots, 70 OpenAPI paths, auth + error contract, full read path
  against seeded data; **full Definition-of-Done scenario passes end-to-end** through
  the real API (resolve URL → influencer → campaign w/ free+paid → deliverable + script
  → paste published content → deliverable auto-published, campaign progress advances,
  content appears in feed + What's New); web production build passes; worker notification
  engine verified; monorepo typecheck 9/9, web lint clean, 18 unit tests pass.

## Database (`packages/database`) — ✅
- Full normalized Prisma schema (all core entities + provenance + snapshots +
  monitoring + costs + notifications/activity + DeviceSession, NotificationDelivery,
  FeatureFlag, ClientConfig, AppVersion). Migrations applied. Realistic seed
  (3 users, 4 brands, 20 influencers w/ 90d follower history, 6 campaigns incl
  free/paid/gifted, deliverables, scripts, costs, published content w/ real
  embeddable URLs + metrics, monitoring events, notifications, activity, integrations,
  client config, app versions, feature flags).

## Shared (`packages/shared`) — ✅
- Client-safe enums + label/tone maps; social provider adapter architecture
  (`SocialPlatformAdapter`, capability matrix, YouTube/X/Instagram/TikTok/Snapchat +
  `ManualAdapterFallback`); URL parsing / content-id extraction; safe embed builder +
  strict iframe origin allowlist; null-safe performance calcs; audience-health signals;
  formatting. Unit-tested.

## Contracts (`packages/contracts`) — ✅
- Request/filter Zod schemas; explicit response DTOs (not Prisma models); error +
  pagination (offset + cursor) envelopes; client-safe enums; **Feature Registry** (the
  source of truth for the Platform & API screens + generated docs).

## Domain (`packages/domain`) — ✅
- Services: auth (Argon2 + JWT access/refresh + DeviceSession), users, brands,
  influencers (directory filters, 360, follower series, audience health), social
  accounts (+ additive snapshots, sync), provider wrapper (resolve/capabilities),
  campaigns (+ progress), campaign-influencers, deliverables, scripts (+ versions),
  content (URL ingest → embed, feed, monitoring/metrics, refresh), costs, notes, brand
  relationships, dashboard aggregation, activity, notifications, search, calendar,
  reports (+ CSV), integrations, platform & API + client-config + feature flags.
  Typechecks clean.

## API (`apps/api`) — ✅
- Fastify under `/api/v1`, Zod validation, `@fastify/swagger` (`/api/docs`,
  `/api/openapi.json`), standardized errors, helmet/CORS/cookie/rate-limit, stateless
  bearer auth guard. 20 route modules, 70 endpoints. Typechecks clean; verified.

## API client (`packages/api-client`) — ✅
- Strongly-typed SDK (single client for web + mobile). Typechecks clean.

## Web (`apps/web`) — ✅ (Next.js production build passes)
- ✅ Foundation: design tokens (light/dark/brand accent), globals, next-intl (en/ar +
  RTL), BFF token transport (httpOnly cookies + `/api/bff` proxy + middleware refresh),
  providers, full UI design system, login.
- ✅ App shell: sidebar, topbar, brand switcher, Quick Add (working forms), command
  palette (⌘K), notifications menu, user menu, theme + locale toggles, mobile nav.
- ✅ **Mission Control** dashboard (Pulse, What's New, Needs Attention, Active
  Campaigns, Upcoming, Recent Activity); reusable `SocialContentPlayer`, ContentCard/
  Viewer/Grid, CampaignCard, InfluencerCard.
- ✅ Feature pages: influencers directory/360/add, campaigns list/workspace/new, live
  content wall, brands + brand workspace, calendar, reports (+ CSV/print), notifications,
  settings incl. **Integrations** + **Platform & API** (API modules, API Explorer,
  Mobile Readiness) + Users + Feature Flags. All routes build & typecheck; web lint clean.

## Worker (`apps/worker`) — ✅
- BullMQ queues (content-check, follower-sync, maintenance) with retry/backoff/rate
  limits + repeatable sweep; content availability + metric refresh; follower sync;
  deliverable/campaign notification generation (deduped); graceful no-Redis fallback;
  health endpoint. Notification engine verified against seeded data.

## Docs — ✅
- ARCHITECTURE, DATABASE, SECURITY, DEPLOYMENT, API, CONTRIBUTING; generated
  FEATURE_MATRIX, MOBILE_READINESS, SOCIAL_PROVIDER_MATRIX (from code). This file.

## Tests — 🟡
- ✅ Unit tests (shared: url/embeds/metrics/audience-health). API smoke + read-path
  verification scripts.
- 🟡 Playwright E2E scaffolded (login → Mission Control → Live Content); requires the
  running stack (CI e2e job gated until app images are wired).

## Known limitations / next
- Provider official sync (YouTube/X/Instagram) is implemented but inactive without API
  keys — the product runs fully in manual-fallback mode (by design).
- Attachments/file upload: schema + API surface present; storage wiring is minimal.
- Saved filter views, deep push notifications, and the mobile app are architected
  (models + Feature Registry) but not implemented (out of scope, by spec).
- App-router soft navigation (Next 15.5): a navigation that changes only the query
  string sometimes never commits — the RSC request is aborted after its headers
  arrive and the old page stays. Reproduced with `router.push` on `/exec` (large
  payload), `/brands?q=…` and dropping `?tab` on a creator profile; `/reports`,
  `/campaigns`, `/content` and the directories are fine. Where it mattered the UI
  avoids it: the owner dashboard and client report reload the page, and the
  campaign workspace rewrites the address with `history.replaceState`. Plain
  link clicks hit it too (measured: about 1 in 5 from Reports to Rate
  benchmarks — the page's data arrives, then the request is dropped), so every
  page has a safety net (`components/common/navigation-watchdog.tsx`): if the
  address hasn't changed 5 seconds after a link click, the page loads the
  ordinary way. A Next.js upgrade is the likely real fix (not done yet).
- A click in the first moment after a page loads, while React is still taking
  over the server-rendered page, can be lost (the link doesn't navigate, the
  dialog doesn't open); a second click works. Measured: about 1 in 12 clicks
  made straight after the load event, none once the page settled. People rarely
  click that fast, tests always do — so every E2E `page.goto` waits for the page
  to settle first (`apps/web/e2e/fixtures.ts`).
