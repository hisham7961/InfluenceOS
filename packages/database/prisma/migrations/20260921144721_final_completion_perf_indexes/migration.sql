-- Final Completion Pass — FC-11: Performance + index review for
-- new/expanded query surfaces added earlier in this pass (Data Quality
-- Center's 11 new findings, the Activity feed's publishedContentId filter,
-- and the concurrently-landing duplicate-detection check). See
-- docs/perf/final-completion-pass-index-review.md for the full review,
-- including the surfaces that were deliberately left unindexed and why.

-- CreateIndex
-- activity.service.ts's buildWhere() gained a `publishedContentId` equality
-- filter — a real column, mirrors the existing brandId/campaignId/
-- influencerId indexes already on this model.
CREATE INDEX "ActivityLog_publishedContentId_idx" ON "ActivityLog"("publishedContentId");

-- CreateIndex
-- data-quality.service.ts's checkDuplicate() (live, per-keystroke-ish
-- duplicate check on Add Influencer / import) does an exact-equality OR
-- branch on mobile/whatsapp — previously unindexed, forcing a full table
-- scan on every call.
CREATE INDEX "Influencer_mobile_idx" ON "Influencer"("mobile");
CREATE INDEX "Influencer_whatsapp_idx" ON "Influencer"("whatsapp");

-- W7-2 precedent (PERF-03/05) continued: two indexes below are raw SQL
-- because Prisma's schema DSL cannot represent them (a `gin_trgm_ops`
-- operator class, and an arbitrary functional/expression index) — both
-- idempotent, safe to re-run.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- checkDuplicate()'s email branch uses Prisma's `equals` + `mode:
-- 'insensitive'`, which compiles to `email ILIKE $1` (case-insensitive,
-- but NOT wrapped in `LOWER()`), not a plain `=` — a standard btree index
-- on email would never be chosen for that predicate. A trigram GIN index
-- (same family as the existing displayName/fullName/primaryUsername
-- indexes below) is what Postgres actually uses for ILIKE, verified with
-- EXPLAIN against a live copy of this database (see the review doc).
CREATE INDEX IF NOT EXISTS "Influencer_email_trgm_idx" ON "Influencer" USING gin ("email" gin_trgm_ops);

-- activity.service.ts's buildWhere() also gained a `shipmentId` filter,
-- compiled by Prisma as an equality comparison on the JSONB path expression
-- `(meta #> ARRAY['shipmentId']::text[])::jsonb` (ActivityLog has no
-- `shipmentId` column — every shipment-related logActivity() call records
-- `meta.shipmentId` instead). A GIN index on the whole `meta` column would
-- NOT be usable here: GIN's jsonb operator classes only serve `@>`/`?`/`?|`/
-- `?&`, never a `#>` path-extraction equality. This functional btree index
-- matches the exact compiled expression instead (confirmed via EXPLAIN
-- ANALYZE against a live copy of this database: a full sequential/
-- index-backed scan of the whole ActivityLog table dropped from ~5ms/8363
-- buffers to ~0.05ms/4 buffers at ~16.7k rows — see the review doc for the
-- full before/after and the reasoning for adding this one, unlike the
-- (deliberately left unindexed) options considered for the other findings).
CREATE INDEX IF NOT EXISTS "ActivityLog_meta_shipmentId_idx" ON "ActivityLog" ((("meta" #> ARRAY['shipmentId']::text[])::jsonb));
