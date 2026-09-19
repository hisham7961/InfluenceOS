-- W7-3: prove the W7-2 directory indexes are used at scale.
-- Run after `pnpm db:seed:load` (10k rows) against a NON-production database:
--   psql "$DATABASE_URL_NO_QUERY" -f scripts/load/explain-directories.sql
ANALYZE "Influencer";
ANALYZE "Campaign";

-- 1. Trigram free-text directory search (ILIKE '%q%') → GIN trigram index.
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, "displayName" FROM "Influencer"
WHERE "displayName" ILIKE '%Creator 5000%'
ORDER BY "createdAt" DESC, id DESC
LIMIT 24;

-- 2. Cursor-order page (createdAt desc, id desc) → composite b-tree index.
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM "Influencer"
ORDER BY "createdAt" DESC, id DESC
LIMIT 24;

-- 3. Campaign name trigram search.
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, name FROM "Campaign"
WHERE name ILIKE '%Campaign 1500%'
LIMIT 24;
