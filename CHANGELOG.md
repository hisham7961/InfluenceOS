# Changelog

All notable changes to InfluenceOS are recorded here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/); versions use
[Semantic Versioning](https://semver.org/).

Change tracking starts from the current validated baseline — no historical
versions are fabricated. Dates are UTC.

## [Unreleased]

Pre-deployment platform-completion work on top of the validated baseline. No
staging or production environment has been deployed.

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
