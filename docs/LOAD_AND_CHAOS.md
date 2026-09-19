# Load & Chaos Harness (W7-3)

Documented behaviour of InfluenceOS **under scale and failure**, with a
reproducible load seed and the query plans / resilience mechanisms that back the
claims. All of this runs against a local or staging database — **never
production** (the seed refuses `NODE_ENV=production` and is opt-in).

## 1. Load seed

A deterministic, clearly-marked, additive seed that inserts ~10k influencers and
~2k campaigns so the directories, cursor pagination and the W7-2 indexes can be
exercised at realistic volume.

```bash
# Insert (opt-in, additive, idempotent). Default 10,000 influencers + 2,000 campaigns.
SEED_LOAD=true pnpm db:seed:load

# Larger run (planner flips to the trigram index well before this):
SEED_LOAD=true LOAD_ROWS=50000 LOAD_CAMPAIGNS=2000 pnpm db:seed:load

# Remove every load-tagged row (leaves real data untouched):
pnpm --filter @influenceos/database exec tsx prisma/seed-load.ts --clean
```

Safety properties:

- **Opt-in** — throws unless `SEED_LOAD=true`; **refuses** `NODE_ENV=production`.
- **Additive** — never wipes; batched `createMany({ skipDuplicates: true })`.
- **Idempotent** — a re-run detects existing load rows (`internalNotes =
  "load-seed"`, brand slug `load-seed-brand`) and tops up rather than
  duplicating.
- **Removable** — every generated row is tagged, so `--clean` deletes exactly
  the load set. The pure row generator lives in
  `@influenceos/shared` (`buildLoadInfluencers`) and is unit-tested.

## 2. Index proof (PERF-03/04/05 — W7-2)

After seeding, verify the directory indexes are used:

```bash
psql "${DATABASE_URL%%\?*}" -f scripts/load/explain-directories.sql
```

### Cursor-order page — composite `(createdAt, id)` index

Used from the first row, at every scale:

```
Limit (actual time=0.020..0.026 rows=24 loops=1)
  ->  Index Only Scan Backward using "Influencer_createdAt_id_idx" on "Influencer"
        Heap Fetches: 24
Execution Time: 0.033 ms
```

### Free-text directory search — trigram GIN index

The cost-based planner picks the GIN index once the table is large enough that a
sequential scan is no longer cheaper. Measured on this schema:

- **10k rows** → `Seq Scan` (planner's choice; a 5 ms scan of 10k rows beats
  index setup). Correct, not a regression — the index exists and is valid.
- **50k rows** → `Bitmap Index Scan on "Influencer_displayName_trgm_idx"`:

```
Limit (actual time=4.972..4.974 rows=1 loops=1)
  ->  Bitmap Heap Scan on "Influencer"
        Recheck Cond: ("displayName" ~~* '%Creator 45000%'::text)
        ->  Bitmap Index Scan on "Influencer_displayName_trgm_idx"
              Index Cond: ("displayName" ~~* '%Creator 45000%'::text)
Execution Time: 5.036 ms
```

To confirm the index is *usable* regardless of the row count, force it:
`SET enable_seqscan = off;` then re-run the search — it uses the trigram index.

## 3. Chaos scenarios

Each scenario names the failure, the **observed behaviour**, and the mechanism
that prevents data corruption. Injection is manual (stop a container / service);
the harness is the checklist below.

| Failure | Behaviour | No-corruption guarantee |
| --- | --- | --- |
| **Postgres down** | API `/ready` returns 503; write endpoints fail fast with a sanitized 5xx (no partial state); `/health` (liveness) still 200 so the orchestrator does not kill a healthy process. | Every multi-row write is wrapped in `$transaction` (W2-4) — a mid-write DB loss rolls back atomically; nothing half-written. |
| **Redis down** | Rate limiting fails open (requests still served); the worker's BullMQ connection retries with backoff; enqueue attempts surface as 5xx rather than silently dropping. | Jobs are only removed from the queue on success; a connection loss leaves them queued for redelivery. |
| **Worker restart** | In-flight jobs are retried (BullMQ attempts + backoff); repeated failures land in the **dead-letter queue** and increment the failure metric (W2-1); `/health` on the worker reports truthfully. | Processors are idempotent (content sync dedupes by canonical URL; uploads by unique `storageKey`, W2-2), so a redelivered job cannot double-write. |
| **MinIO / S3 slow** | Presign + upload calls are bounded; a slow object store degrades uploads only — reads and the rest of the API are unaffected (object storage is off the hot path). | Two-phase upload: the DB row is only marked complete after the object exists; an abandoned upload is swept, never left dangling. |
| **Graceful shutdown (SIGTERM)** | API and worker drain in-flight work, stop accepting new work, close DB/Redis, then exit (deploy/rollback safe). | No connection is severed mid-transaction; the drain completes or the transaction rolls back. |

Run order for a manual drill (staging): seed load data → start API + worker →
stop Postgres (observe `/ready` 503) → restart → stop Redis (observe fail-open)
→ restart → `docker kill` the worker mid-sweep (observe retry/DLQ) → verify row
counts are unchanged (`SELECT count(*)` before/after == no corruption).

## 4. Core Web Vitals capture

Capture LCP / CLS / INP against the load-seeded stack (large directories are the
worst case):

```bash
# With the web app running against the load-seeded DB:
npx lighthouse http://localhost:3000/influencers \
  --only-categories=performance --preset=desktop --output=json \
  --output-path=./web-vitals-influencers.json
```

Targets (directory + dashboard routes): LCP < 2.5 s, CLS < 0.1, INP < 200 ms.
The W5-4 perf-hygiene work (`next/dynamic` for charts, `next/image` for imagery)
and the server-side rollups (W6-1/W6-2/W6-3, no browser metric math) keep these
in range as data grows. Full cross-browser/responsive/RTL capture is tracked in
the W5-6 acceptance matrix.
