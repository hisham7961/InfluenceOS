# Changelog

All notable changes to InfluenceOS are recorded here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/); versions use
[Semantic Versioning](https://semver.org/).

Change tracking starts from the current validated baseline — no historical
versions are fabricated. Dates are UTC.

## [Unreleased]

Pre-deployment platform-completion and freeze-candidate work on top of the
validated baseline. No staging or production environment has been deployed.

### Owner decisions — the open items finished

- **Arabic everywhere it was missing** — Arabic dates use full month names;
  activity lines no longer leave English values (platforms, roles, channels,
  country codes, bulk actions) inside Arabic sentences, old rows included.
- **Arabic-aware search** — أ/إ/آ/ا, ى/ي, ة/ه, diacritics and tatweel all
  match each other in the search page, quick palette, directory, pickers,
  campaign list, content feed and Trends (`ar_fold()` + `foldArabic()`).
  Fixed: a brand-scoped user's Trends search also listed other brands' items.
- **Saved post covers** — the worker keeps our own copy of each cover (safe
  fetch from the platforms' image hosts only), served by a signed, day-stable
  `/api/v1/covers/:id` link; `COVER_BATCH_SIZE`.
- **Creators upload the draft file** on their task link (photo/video, up to
  `MAX_UPLOAD_MB`, private, one upload = one draft).
- **AI reads audience screenshots** in the Audience dialog (countries,
  women/men, ages, engagement) — suggestions only, same switch and limit.
- **Least-privilege logins from `.env`** — `APP_DB_USER/APP_DB_PASSWORD` and
  `MINIO_APP_USER/MINIO_APP_PASSWORD` make rows-only / bucket-only logins on
  the next deploy (checked in CI); `scripts/server-changes.sh` shows
  hand-made server changes before each deploy. `MAX_UPLOAD_MB` now passes
  through the production compose file.
- `docs/OWNER_DECISIONS_AR.md`: every item decided; what still needs the
  owner is listed at the top.
- **Link clicks that did nothing** — Next.js 15.5 sometimes fetches the next
  page and then drops it (about 1 in 5 clicks from Reports to Rate
  benchmarks). A safety net now loads the page the ordinary way if the address
  hasn't changed 5 seconds after a link click; working navigations are
  untouched. Tab icon added.
- **E2E** — every `page.goto` waits for the page to settle before the test acts
  (`e2e/fixtures.ts`); clicks made while React was still taking over were
  being lost. The exec-dashboard check no longer matches "Posts published" in
  the "Since yesterday" list.

### Freeze candidate — release readiness gate (this pass)

- **Influencer photo sync** — a "Sync photo" action on the Influencer 360
  profile re-resolves the creator's avatar from their linked social account
  (official API first, public og:image fallback); linking a new primary
  social account now also best-effort backfills a missing photo at link time.
- **Fixed 4 real bugs surfaced by the pre-existing Playwright E2E suite**:
  `campaigns.json`'s `submissions`/`shipments`/`sourcing`/`operations` keys
  were nested one level too deep, causing next-intl to render raw dotted key
  paths instead of translated text across those campaign tabs; the Admin
  Users edit-access sheet silently dropped the person's email from its
  description (a `t.rich()`/plain-placeholder mismatch); the shared
  `DropdownMenuContent` had no height cap, so a menu with enough items (many
  saved views) could render entirely below the viewport with no way to
  scroll to it; two E2E specs asserted stale pre-translation English/
  always-plural copy against now-correctly-translated/pluralized UI.
- **Dependency audit** — vitest 2.1.8 → 2.1.9 (devDependency only; closes a
  critical RCE advisory, GHSA-9crc-q9x8-hgqq).
- Full regression after all of the above: typecheck/lint clean, i18n parity
  holds (21 namespaces, 2045 keys), 404 API + 33 domain + 78 shared unit/
  integration tests green, full Playwright E2E suite (6 spec files, 15 test
  cases, across content-command-center, content-association,
  advanced-roles-logistics, operations-intelligence, dod, smoke) green, CI
  green on the frozen SHA.

### Freeze candidate (maintenance cleanup)

- **Controlled Next.js + dependency security upgrade** — next 15.1.6 → 15.5.25
  (stays on the maintained 15.x line, no major jump), @fastify/swagger-ui
  5.2.2 → 6.1.1 (pulls @fastify/static 10.1.3), fastify 5.8.5 → 5.12.3,
  postcss → 8.5.28, @playwright/test 1.49.1 → 1.56.1. `pnpm audit --prod` went
  from **4 critical / 17 high** to **0 critical / 0 high** (3 moderate, 1 low
  remain, each classified as not reachable in this app/topology — see
  `docs/PRE_DEPLOYMENT_STATUS.md` §5). Fixed a latent reports Server/Client
  boundary bug the upgrade surfaced.
- **Exact-decimal money** — all monetary arithmetic is now `Prisma.Decimal`
  (never JS float; `0.1 + 0.2` is exactly `0.3`), converted to a `number` DTO
  once at the boundary and rounded to the money scale; storage widened to
  `Decimal(18,3)` for KWD fils. FREE stays an exact 0, a missing amount stays
  null, currency is preserved, no FX. Unit + end-to-end precision tests added.
- **Account-persisted theme/locale** — the preference is saved on the user
  account (PATCH `/auth/me/preferences`) and applied on login across devices, so
  the "saved to your account" copy is truthful; EN/AR (RTL) and light/dark
  unchanged.
- **One shared auth-transport source** — cookie names/lifetimes live in
  `@influenceos/contracts/transport`, imported by the web BFF, the edge
  middleware, and the API (pinned by a contract test) to remove drift.
- **Lightweight background refresh** — refetch-on-focus, a 60s interval on the
  Live Content wall, and a throttled `RefreshOnFocus` on Mission Control. No
  WebSockets.
- **Regression tests** — deal-type money semantics (PAID/FREE/GIFTED/
  PAID_PLUS_GIFTED), preference persistence, transport constants.

### Changed (freeze candidate)

- Removed the unused `framer-motion` web dependency.
- Regenerated `docs/FEATURE_MATRIX.md` / `docs/MOBILE_READINESS.md` from the
  registry (re-synced two stale rows) and added the preferences endpoint.

### Added
- **Deployment preflight** — `scripts/preflight.sh`: non-destructive readiness
  report (env, docker/compose, disk, memory, ports, DNS, dependency
  connectivity, compose validation). Changes nothing.
- **Abandoned-upload cleanup** — a worker maintenance task removes storage
  objects from uploads that were never completed (no `Attachment` row), with a
  24h grace window so in-flight uploads are never touched; surfaced in worker
  health as `abandonedUploadsCleaned`. Storage drivers gained a `list()` method.
- **Security tests** — access control on mutating admin operations, brand
  isolation (scoped queries don't leak across brands), and signed-download
  authorization (cross-file ticket, tampered ticket, missing ticket, expired
  ticket).
- **Compose validation in CI** — all three compose files must pass
  `docker compose config`.
- **Docs** — `CHANGELOG.md`, `docs/DEPLOYMENT_HANDOFF.md`,
  `docs/PRE_DEPLOYMENT_STATUS.md`.
- **Web workflows** — completed in-scope UI actions that previously had no entry
  point despite existing APIs (see the pre-deployment status matrix for the
  authoritative list): active-session management, campaign edit/status and
  roster/deliverable/expense/script mutations, brand/influencer edit, and
  social-account management, plus a real Settings → General page.

### Changed
- Docker images (api/worker/web) now run as the unprivileged `node` user.
- CSP `connect-src`/`img-src` explicitly permit the configured object-storage
  origin (`S3_PUBLIC_ENDPOINT`).
- `.gitignore` ignores all real `.env.*` files; only `*.example` templates are
  tracked.

### Security
- Independent static audit (secrets, dangerous sinks, SQL, web↔Prisma boundary,
  CORS, embeds, object-storage access, logging redaction, browser token storage)
  — no high/medium findings.

## [Baseline] — validated release candidate

The starting point for this changelog: the InfluenceOS platform as validated
through production-readiness and staging-preparation, with green CI across
secret scan, build/typecheck/lint, unit + integration (incl. real MinIO S3
round-trip) + contract + DoD tests, production image builds, full-stack browser
E2E, and browser S3 E2E.

Includes: API-first architecture (Fastify `/api/v1`, domain services,
PostgreSQL/Prisma, BullMQ worker, private S3/MinIO object storage), Next.js web
client via a BFF token transport, Argon2 + rotating-refresh-token auth with
account lockout, feature registry / Platform & API center, reports, calendar,
notifications, activity + admin audit log, attachments with two-phase signed
uploads, observability (`/health`, `/ready`, `/metrics`), and the full
deployment tooling (reverse-proxy configs, deploy/rollback/backup/restore
scripts, monitoring templates, production + staging environment templates).
