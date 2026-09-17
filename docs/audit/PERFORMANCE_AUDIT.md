# InfluenceOS — Performance Audit

**Audit HEAD:** `85b6c852`. Evidence = code analysis (Agents 05 DB, B6 frontend) + lead live `EXPLAIN` on the running DB. **Not** a full load test — Core Web Vitals field data and a 10k-row load harness are a WAVE-7 item; the findings below are proven by query plans, query counts, and bundle composition.

## Backend / database (the dominant risk at scale)
| ID | Sev | Finding | Evidence | Impact at 10k |
| --- | --- | --- | --- | --- |
| PERF-01 | **P2** | **N+1 in campaign list** — `computeCampaignProgress` runs per row (6 queries each) | `campaign.service.ts:99-101` + `progress.ts:28-39` | dashboard + campaign directory = **6N queries/page** |
| PERF-02 | **P2** | **N+1 in reports** — campaign/brand/spend reports loop `MAX_ROWS=500` × 3-5 subqueries | `report.service.ts:127-150,242-253,317-324` | ~**2,500 queries** per report render |
| PERF-03 | **P2** | **Seq scans on directories** — influencer & campaign lists have no usable index for their filter+sort; **live `EXPLAIN` = Seq Scan + in-memory Sort** | live; `influencer.service.ts:85`, `campaign.service.ts:93` | full-table scan per page |
| PERF-04 | P3 | Offset pagination (`skip/take` + `count` each request) on those directories | same | slow `count`, unstable pages under concurrent insert |
| PERF-05 | P3 | Missing `@@index` on `Campaign.ownerId`, `ActivityLog.actorId`; country/category `ILIKE '%…%'` can't use a b-tree index | schema | filter scans |

**Fixes:** batch progress with grouped aggregates (one query, not 6N); cap/aggregate report subqueries or precompute; add composite indexes matching each directory's `WHERE`+`ORDER BY` (and a `pg_trgm` GIN index for name search); move influencer/campaign directories to cursor pagination (content/audit/reports already use cursors). **Acceptance:** re-run `EXPLAIN` shows Index Scan; campaign list issues O(1) aggregate queries, not O(6N).

## Frontend
| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| PERF-06 | P3 | `recharts` (~90 kB) **statically** imported into the influencer-detail chunk; `next/dynamic` used **0×** app-wide | `follower-chart.tsx:6` |
| PERF-07 | P3 | Raw `<img>` in 8 places, only 1 `next/image` → no resize/lazy/intrinsic size (CLS + bandwidth), esp. content cards with many thumbnails | `content-card.tsx:21` +7 |
| PERF-08 | P4 | High `'use client'` ratio (63/110) — larger client bundle than necessary | app-wide |
| PERF-09 | P4 | Content wall + monitoring poll on interval/focus (added in the freeze pass) — fine now, but verify it doesn't stack refetches on the embed-heavy Live Content page at scale | `content-wall.tsx`, providers |

**Fixes:** lazy-load recharts via `next/dynamic` (with an aspect-ratio placeholder); adopt `next/image` for content/avatar imagery; audit `'use client'` boundaries on data-display components; keep polling conservative and paused when hidden (already `refetchIntervalInBackground:false`).

## Verified NOT a problem
No server+client double-fetch (server `Promise.all` + react-query `initialData` seeding); reasonable `staleTime` (30s) and focus-refetch throttling; lists are paginated/infinite (no need for virtualization at current data volumes); the money/Decimal path is not a hot loop. Runtime is clean (no memory-leak signals observed in the console/network sweep, though sustained-session memory profiling is a WAVE-7 item).

## Representative screens to measure in WAVE 7 (with a seeded 10k dataset)
Mission Control, Influencer directory, Influencer 360, Campaign workspace (embed-heavy), Live Content (many embeds), Reports (N+1 heavy), Global Search. Capture TTFB/LCP/INP, query counts per request, duplicate requests, and memory growth over a 30-min session.
