# InfluenceOS — A-to-Z Technical Audit

**Audit HEAD:** `85b6c8522deb58a2a9528d13151d1ee75b66f1fd` (branch `claude/new-session-2rsnjm`)
**Prior validated freeze baseline:** `410c587da7f92c8010bebbd5a59c24cbb31d8eb8`
**Method:** 14 independent specialist reviewers (isolated contexts) + lead live testing against a running native stack. Every finding is proven from code (`file:line`); no prior audit or doc was trusted.
**Severity:** P0 catastrophic · P1 serious · P2 meaningful · P3 polish/maintainability · P4 enhancement.

Companion reports: `SECURITY_RED_TEAM.md`, `RUNTIME_BROWSER_AUDIT.md`, `SETTINGS_REALITY_MATRIX.md`, `PERFORMANCE_AUDIT.md`, `PRODUCT_GAP_ANALYSIS.md`, `INFLUENCER_UGC_EXPERT_REVIEW.md`, `UI_UX_AUDIT.md`, `DESIGN_SYSTEM_PROPOSAL.md`, `AUDIT_MASTER_PLAN.md`.

---

## 0. Repository truth & architecture verdict

Monorepo: `apps/{api,web,worker}` + `packages/{contracts,domain,database,shared,api-client}`. 22 API route files (95 real routes), 22 web pages, 22 domain services, 28 Prisma models, 6 migrations, 16 API test files.

**API-first claim = TRUE and structurally enforced** (Agent 01, proven): web imports zero `@prisma/client`/`PrismaClient`/`@influenceos/{database,domain}`; domain imports nothing from api/web; API touches Prisma only in `index.ts` (`$connect`) and `health.ts` (`SELECT 1`), never in `routes/`. Dependency graph is an acyclic DAG (apps→packages; leaves = shared, database). No committed secrets, no tracked build artifacts, no TODO/stub markers. Enums single-sourced in `shared`.

**The one real architecture violation:** the campaign **Performance tab computes CPV/CPM/cost-per-content in the browser** (`apps/web/src/app/(app)/campaigns/[id]/workspace.tsx:1679-1713`) — business math outside the domain layer, duplicating `packages/shared/src/metrics/performance.ts`, and breaking the registry's `mobileReady:true` claim for that surface. (P2, ARCH-01)

## 1. Change-delta audit (freeze `410c587` → HEAD `85b6c852`)

Three post-freeze commits, all **infra-only** and **all three failed CI** (runs #16/#17/#18):

| Commit | What | Verdict |
| --- | --- | --- |
| `680069e` add production Docker deployment | +`openssl` in `Dockerfile.api`/`worker`; compose edits | `openssl` add is **correct** (Prisma needs libssl on `bookworm-slim`; web Dockerfile rightly omits it). |
| `9fd235e` GitOps rebuilds + pin compatible MinIO | pinned `docker-compose.yml` MinIO → `quay.io/minio/minio:RELEASE.2022-10-24T18-35-07Z`; `pull_policy: build` | Pin is sound **but applied to the wrong file** — no deploy script uses `docker-compose.yml`. |
| `85b6c85` MinIO compatible with legacy CPU | (same pin) | Legitimate intent (older MinIO predates the AVX/SSE requirement), incompletely propagated. |

**These three commits did NOT invalidate application code, security guarantees, backup/restore assumptions, or the browser S3 contract at the code level — the only regression they introduced is the CI/deploy MinIO image-source inconsistency (WAVE 0).**

## 2. WAVE 0 — the CI regression (root cause, proven from run #18 logs)

`build` job step "Start MinIO" runs `docker run … minio/minio server /data`. CI log line 392-393:
```
Unable to find image 'minio/minio:latest' locally
docker: Error response from daemon: pull access denied for minio/minio,
repository does not exist or may require 'docker login': denied
```
Docker Hub now **denies anonymous pulls of `minio/minio`**. Downstream `e2e`, `e2e-s3`, and `images` jobs were **skipped** (correct fail-fast).

**Image source-of-truth is inconsistent (8 refs, 4 divergent specs):**

| Location | Current | Reachable? |
| --- | --- | --- |
| `docker-compose.yml:44` | `quay.io/minio/minio:RELEASE.2022-10-24T18-35-07Z` | ✅ (but not used by any deploy script) |
| `.github/workflows/ci.yml:135,282,423` | `minio/minio` (Docker Hub `latest`) | ❌ denied → **CI red** |
| `docker-compose.full.yml:56` (used by `deploy-production.sh`) | `minio/minio:latest` + `mc:latest` | ❌ → **prod deploy would hit the same failure** |
| `docker-compose.staging.yml:95` | `minio/minio:latest` | ❌ |

**CRITICAL NUANCE (Agent 08/09, F9):** `RELEASE.2022-10-24` **predates `MINIO_API_CORS_ALLOW_ORIGIN`** (added mid-2023), which `docker-compose.staging.yml:104` and the `e2e-s3` job (`ci.yml:422`) depend on for browser presigned uploads. **A blind single-source pin to the 2022 tag silently breaks browser S3 CORS.** The correct fix pins a **2024 CORS-capable quay release everywhere** (or a managed S3); only if the deploy host truly can't run a modern MinIO should production stay on the 2022 tag with a documented same-origin-proxy fallback and a newer tag in `e2e-s3`. Fix spec + exact edit list are in `AUDIT_MASTER_PLAN.md` (WAVE 0). **Not applied in this audit pass — held for approval** (local testing uses native processes, not Docker, so it is not required to run this audit).

## 3. Database & data integrity (Agent 05 — 0 P0/P1, 6 P2)

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| DB-01 | P2 | N+1: campaign list calls `computeCampaignProgress` per row (6 queries each) → 6N queries/page on dashboard + campaign directory | `campaign.service.ts:99-101` + `progress.ts:28-39` |
| DB-02 | P2 | N+1: campaign/brand/spend reports loop `MAX_ROWS=500` × 3-5 subqueries each → ~2500 queries per report render | `report.service.ts:127-150,242-253,317-324` |
| DB-03 | P2 | **Mixed-currency summation** — `agreedCost + expense.amount` summed ignoring per-row `currency`, output labelled campaign currency / hard-coded `KWD`. Benign only while all data is KWD. *(Triple-corroborated: Agents 05, B3, B4.)* | `progress.ts:126-138`, `report.service.ts:22` |
| DB-04 | P2 | `Attachment.campaignId` indexed but has **no FK relation** → no referential integrity; deleting a campaign orphans attachments (storage leak) | `schema.prisma:684,691-698` |
| DB-05 | P2 | Platform-flag `@@unique([key,scope,brandId])` — PG treats NULL as distinct, so global flags (`brandId=NULL`) aren't deduped; `setFlag` find-then-create can create duplicate/contradictory flags | `schema.prisma:836`, `platform.service.ts:363-372` |
| DB-06 | P2 | Broad `CASCADE` chain Brand→Campaign→CampaignInfluencer→Deliverable/Expense; a brand hard-delete (if an endpoint is added) wipes all financial history; exposed `CI.remove()` destroys deliverables + `agreedCost` | init migration:694,700,706 |
| DB-07 | P3 | Multi-step writes **not** wrapped in `$transaction` (content create + deliverable status + activity + notification; CI add + brandInfluencer increment) → partial state on failure | `content.service.ts:121-175`, `campaign-influencer.service.ts:110-146` |
| DB-08 | P3 | Offset pagination (skip/take + count) on influencer & campaign directories → unstable under concurrent inserts, slow `count` at 10k rows. **Live-confirmed: EXPLAIN shows Seq Scan + in-memory Sort** on both. | `influencer.service.ts:86-88`, `campaign.service.ts:94-96` |
| DB-09 | P3 | Missing `@@index` on `Campaign.ownerId`, `ActivityLog.actorId` (both filtered); country/category ILIKE bypasses indexes | schema + service filters |

**Verified correct (not defects):** refresh rotation is transactional (`SELECT … FOR UPDATE` + grace-token idempotency + commit-then-throw on reuse); `recordMetrics` uses `$transaction`; `money.ts` is exact `Decimal` with FREE=0 / missing=null preserved (no float in the money path); the `DECIMAL(14,2)→(18,3)` migration is a safe widening; unique constraints on handles / campaign-influencer / published content / brand-influencer are sound.

**Data-integrity product bug (Agent B1, verified live):** `campaign-influencer.service.ts:127-138` — `add()` flips `BrandInfluencer→ACTIVE` and increments `totalCollaborations` at **add time**, before the creator confirms or delivers. Invited-then-declined creators permanently inflate `totalCollaborations`/`averageRate`/brands-worked-with, corrupting the very selection data staff rely on. (P2, DB-10)

## 4. Object storage & worker/queue (Agent 06/07 — 0 P0/P1, 4 P2)

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| WK-01 | P2 | S3 presigned **PUT has no size cap** (no `content-length-range`); size enforced only at `complete`, so a client can upload unbounded bytes and, by never completing, bypass the limit and leave orphans ≥24h — storage/cost DoS | `storage.ts:84-90`, `attachment.service.ts:147,176-181` |
| WK-02 | P2 | Uploads **not validated server-side** — only the client-declared `mimeType` is checked against the allowlist then stored/served; bytes never sniffed, no AV (XSS blunted by allowlist + `nosniff`, so integrity-level) | `attachment.service.ts:104-115,125,166` |
| WK-03 | P2 | No `.on('failed')`/`.on('error')` on any Worker/Queue; a job that always throws exhausts `attempts:3` then is **silently dropped** (`removeOnFail:200`) — no dead-letter queue, no alert, stats never count failures | `worker/index.ts:98-122` |
| WK-04 | P2 | Worker `/health` **always returns 200 `{status:'ok'}`**, including inline-fallback (Redis DOWN) and `starting` — liveness/readiness see healthy while the queue backbone is dead | `worker/index.ts:148-160` |
| WK-05 | P3 | `complete` is replayable / non-idempotent (valid 900s token + no `@unique` on `storageKey`) → duplicate Attachment rows + activity logs | `attachment.service.ts:174-208` |
| WK-06 | P3 | Cleanup lists the **entire bucket** and loads all keys into memory each run; `lastCleanupAt` is in-memory so a restart loop defeats the hourly throttle | `attachment.service.ts:260-279` |
| WK-07 | P3 | `void main()` with no catch — if Redis dies between the availability probe and queue setup, the rejection is unhandled, no queues run, health still `ok` | `worker/index.ts:162-168` |

Verified sound: presigned expiries (PUT 900s / GET 600s), random server-bound object keys (no arbitrary-key write), local upload proxy is `bodyLimit`-bounded, graceful shutdown drains, retry/backoff policy itself is correct, filename header injection blocked by `sanitizeFileName`.

## 5. API contracts & mobile readiness (Agent 10 — 0 P0/P1, 2 P2)

- **API-01 (P2):** the Feature Registry (source of `GET /platform/endpoints` and `FEATURE_MATRIX.md`) **omits 31 of 95 real routes** (notes CRUD, brand-influencer CRUD, content refresh/manual-metrics, integration test/capabilities, notifications/unread-count, most platform admin). `contract.test.ts` only checks the forward direction, so drift is unguarded.
- **API-02 (P2):** OpenAPI has **zero response schemas** for all 95 endpoints (no `response:` anywhere) — an SDK generated from it gets untyped responses (mitigated only because web + a future RN client share the hand-typed `@influenceos/api-client`).
- **API-03 (P3):** `sort`/`order` query params are advertised but **silently ignored** (services use hard-coded `orderBy`).
- **API-04 (P3):** "one consistent pagination system" is false — `offsetQuerySchema`/`cursorQuerySchema` are dead code; 5 cursor endpoints each define different limit bounds.
- **API-05/08 (P3):** 3 registry routes have no client method; 3 list endpoints (`/campaigns/:id/influencers`, `/brands`, `/users`) are unbounded.
- **Positives:** input-validation coverage is **complete** (every body/params/querystring validated); error envelope consistent; server money is exact `Decimal`.

## 6. Infrastructure / CI / supply chain (Agent 08/09)

Beyond WAVE 0 (§2): production compose (`docker-compose.full.yml`) has **no restart policy** on postgres/redis/minio/api/worker/web (staging is correct); prod images are **single-stage `COPY . .`** shipping dev deps + source + tests + toolchain and run via `tsx`; GitHub Actions pinned to **mutable major tags** not SHAs; `gitleaks` fetched via `curl|tar` with no checksum; `pnpm audit` in CI runs `|| true` masking advisories. `pnpm audit --prod` = **0 critical / 0 high / 3 moderate / 1 low** (next-intl not-reachable, uuid `buf`-only, `@smithy` low). Deploy/rollback/backup/restore/preflight scripts are solid (immutable-SHA deploy, pre-deploy backup, health gating, `pg_restore --list` integrity, GFS retention, `--yes` guards); `${VAR:?}` secret guards and non-root `USER node` present in images; `onlyBuiltDependencies` allowlist blocks install scripts; no git deps in lockfile.

## 7. Runtime confirmation (lead, live)

Server-side authorization enforced (STAFF=403 on admin endpoints, valid `POST /users`=403, UNAUTH=401); error envelopes clean, no stack/DB leakage; EXPLAIN confirms directory seq scans; theme/locale account persistence **works** across a fresh login (adjudicated — corrects a settings false positive); browser console sweep across 12 pages = **no console errors / pageerrors / 5xx** (only benign RSC-prefetch aborts). Full detail in `RUNTIME_BROWSER_AUDIT.md`.

## 8. Consolidated technical severity (this report's scope)

P0: **0** · P1: **1** (WAVE-0 CI/prod MinIO regression) · P2: **~16** · P3: **~20** · P4: several. Product-capability gaps and UI/UX are counted in their own reports.
