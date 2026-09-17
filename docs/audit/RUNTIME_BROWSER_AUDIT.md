# InfluenceOS — Runtime & Browser Audit

**Audit HEAD:** `85b6c852`. Executed by the lead against a **running native stack** (PostgreSQL 16, Redis, API :4000, Worker :4100, Web :3000 production build) with seed data (4 users, 21 brands, 41 influencers, 21 campaigns, 9 content items). This report contains only things that were **actually executed**, not inspected.

## Environments actually tested
| Dimension | Tested | Notes |
| --- | --- | --- |
| Browser | **Chromium 1194** (Playwright 1.56.1) | Firefox / WebKit **NOT tested** — not provisioned in this sandbox (only Chromium is installed). Reported honestly as untested. |
| Theme | light + **dark** (adjudicated live) | |
| Locale | English LTR + **Arabic RTL** (adjudicated live) | |
| Role | ADMIN + STAFF (live token probing) | |
| Viewport | desktop (Playwright default) | Mobile/tablet width interaction not exhaustively driven live — static review in `UI_UX_AUDIT.md`; a full responsive/RTL browser matrix is a WAVE-5 acceptance task. |

## 1. Authorization matrix (live-probed, curl against :4000)
| Endpoint | UNAUTH | STAFF | ADMIN | Verdict |
| --- | --- | --- | --- | --- |
| `GET /users` | 401 | **403** | 200 | admin-gated ✅ |
| `GET /platform/storage` | 401 | **403** | 200 | admin-gated ✅ |
| `GET /platform/audit` | 401 | **403** | 200 | admin-gated ✅ |
| `GET /platform/flags` | 401 | **403** | 200 | admin-gated ✅ |
| `GET /integrations` | 401 | **200** | 200 | STAFF can read integration status (no secrets returned) — by design |
| `POST /users` (valid body) | 401 | **403** | 201 | admin-gated ✅ (note: invalid body returns 422 *before* the 403 — validation precedes authz; minor info-disclosure, no bypass) |
| `PATCH /platform/flags/:k` | 401 | **403** | 200 | admin-gated ✅ |
| `PATCH /integrations/:p` | 401 | **403** | 200 | admin-gated ✅ |
| `PATCH /brands/:id` | 401 | **403** | 200 | brand edit is admin-only ✅ |
| `PATCH /campaigns/:id` | 401 | **200** | 200 | operational data is STAFF-writable — flat-org model (see SEC-04) |
| `PATCH /influencers/:id` | 401 | **200** | 200 | same |

**Conclusion:** the ADMIN-vs-STAFF boundary is enforced **server-side** (not just hidden UI). There is **no** per-brand tenant boundary — all authenticated staff have global read/write on operational data (intended flat model; the limitation is the absence of a least-privilege role, SEC-04).

## 2. Error handling (live)
`GET /api/v1/brands/../../etc/passwd` → clean `404 NOT_FOUND` envelope; bad cuid → `404 "Campaign not found."`; no endpoint returned a stack trace or DB error. Error contract holds under adversarial input. ✅

## 3. Database behaviour (live EXPLAIN)
- Influencer directory query (`ILIKE '%…%' ORDER BY createdAt DESC LIMIT 24`) → **Seq Scan + in-memory Sort** (no usable index). Confirms DB-08/DB-09.
- Campaign list (`ORDER BY status, startDate`) → **Seq Scan + Sort**.
- No index on `Campaign.ownerId` / `ActivityLog.actorId`.
Fine at 41 rows; at 10k+ influencers this is a full scan per page **on top of** the 6N progress N+1 (DB-01).

## 4. Theme / locale persistence adjudication (resolves a settings-agent claim)
The settings reviewer flagged account theme/locale persistence as "decorative / follows-you-to-any-device is false." **Live test disproves that:** set the account to `theme=dark, locale=ar` in the DB, perform a **fresh login** (new cookie jar), and `GET /` returns `<html lang="ar" dir="rtl" class="dark">`. The account preference **is** applied cross-device via the login-time DB→cookie bridge (`api/session/login/route.ts:32-33`). It is **not live-reactive** (a change on device A doesn't push to an already-open device B), and the DB column isn't read at render time — but it is **not decorative**. This is recorded as a **corrected false positive**; the genuinely decorative settings are listed in `SETTINGS_REALITY_MATRIX.md`.

## 5. Browser console / network error sweep (Playwright, 12 authenticated pages)
Logged in as ADMIN and visited `/`, `/brands`, `/influencers`, `/campaigns`, `/content`, `/reports`, `/calendar`, `/notifications`, `/settings`, `/settings/security`, `/settings/platform`, `/settings/audit`, capturing `console.error`, `pageerror`, `requestfailed`, and any HTTP ≥500.

**Result: zero console errors, zero page/hydration errors, zero 5xx.** The only captured entries were `net::ERR_ABORTED` on Next.js RSC prefetch requests (`?_rsc=…`) — a benign artifact of the test navigating away before soft-navigation prefetches resolve, **not** a defect. The app is runtime-clean.

## 6. Prior full-stack E2E (re-confirmed this session earlier in the branch)
The Playwright **smoke suite (5/5)** and the **full browser Definition-of-Done journey** (login → brand → influencer → campaign → deliverable → content → attachment → admin pages) pass against this build on Chromium. (The CI `e2e` / `e2e-s3` jobs that also run these are currently red **only** because of the MinIO image-pull regression — not because of the journeys themselves.)

## 7. What could NOT be tested here, and why
- **Firefox / WebKit** — browsers not provisioned in the sandbox (Chromium only). A cross-browser matrix is a WAVE-5 acceptance item.
- **Production Docker images / compose** — no Docker daemon locally (stack runs as native processes); the CI `images` job normally covers this but is currently skipped due to WAVE 0.
- **Browser S3 presigned upload over MinIO** — validated previously via the `e2e-s3` CI job; locally the native MinIO binary was not confirmed up, so file-upload was exercised via the local-disk driver only.
- **True 10k-influencer scale / chaos (pg down, redis down mid-mutation)** — not executed at scale in this pass; the N+1 and seq-scan risks are proven by code + EXPLAIN rather than a load test. A scale/chaos harness is a WAVE-7 item.
