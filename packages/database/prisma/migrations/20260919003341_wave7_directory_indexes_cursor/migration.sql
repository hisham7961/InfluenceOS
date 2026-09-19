-- CreateIndex
CREATE INDEX "Campaign_createdAt_id_idx" ON "Campaign"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Influencer_createdAt_id_idx" ON "Influencer"("createdAt", "id");

-- W7-2 (PERF-03/05): trigram indexes so directory free-text search (ILIKE
-- '%q%') is an Index Scan instead of a sequential scan at scale. These GIN
-- indexes use gin_trgm_ops, which Prisma's schema cannot represent, so they
-- live as raw SQL here (idempotent — safe to re-run).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Influencer_displayName_trgm_idx" ON "Influencer" USING gin ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Influencer_fullName_trgm_idx" ON "Influencer" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Influencer_primaryUsername_trgm_idx" ON "Influencer" USING gin ("primaryUsername" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Brand_name_trgm_idx" ON "Brand" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Campaign_name_trgm_idx" ON "Campaign" USING gin ("name" gin_trgm_ops);
