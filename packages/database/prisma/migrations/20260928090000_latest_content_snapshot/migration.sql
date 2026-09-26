-- P2.8: each post points at its newest metric snapshot, so reads join one
-- row instead of loading every snapshot the post ever had.

-- AlterTable
ALTER TABLE "PublishedContent" ADD COLUMN     "latestSnapshotId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PublishedContent_latestSnapshotId_key" ON "PublishedContent"("latestSnapshotId");

-- AddForeignKey
ALTER TABLE "PublishedContent" ADD CONSTRAINT "PublishedContent_latestSnapshotId_fkey" FOREIGN KEY ("latestSnapshotId") REFERENCES "ContentMetricSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kept current by the database itself, whatever writes the snapshot (worker,
-- manual entry, bulk entry, imports): a newer snapshot takes over; when the
-- pointed-at one is removed or moved, the newest remaining one is found again.
CREATE OR REPLACE FUNCTION influenceos_refresh_latest_snapshot(content_id TEXT) RETURNS void AS $$
  UPDATE "PublishedContent"
     SET "latestSnapshotId" = (
       SELECT s."id" FROM "ContentMetricSnapshot" s
        WHERE s."publishedContentId" = content_id
        ORDER BY s."capturedAt" DESC, s."id" DESC
        LIMIT 1)
   WHERE "id" = content_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION influenceos_content_snapshot_latest() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "PublishedContent" pc
       SET "latestSnapshotId" = NEW."id"
     WHERE pc."id" = NEW."publishedContentId"
       AND (pc."latestSnapshotId" IS NULL
            OR (SELECT s."capturedAt" FROM "ContentMetricSnapshot" s WHERE s."id" = pc."latestSnapshotId") <= NEW."capturedAt");
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM influenceos_refresh_latest_snapshot(NEW."publishedContentId");
    IF OLD."publishedContentId" IS DISTINCT FROM NEW."publishedContentId" THEN
      PERFORM influenceos_refresh_latest_snapshot(OLD."publishedContentId");
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only when the removed snapshot was the newest (or its pointer was
    -- already cleared by the foreign key); thinning old history is cheap.
    IF EXISTS (
      SELECT 1 FROM "PublishedContent" pc
       WHERE pc."id" = OLD."publishedContentId"
         AND (pc."latestSnapshotId" IS NULL OR pc."latestSnapshotId" = OLD."id")
    ) THEN
      PERFORM influenceos_refresh_latest_snapshot(OLD."publishedContentId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContentMetricSnapshot_latest"
AFTER INSERT OR UPDATE OR DELETE ON "ContentMetricSnapshot"
FOR EACH ROW EXECUTE FUNCTION influenceos_content_snapshot_latest();

-- Backfill every existing post.
UPDATE "PublishedContent" pc
   SET "latestSnapshotId" = l."id"
  FROM (
    SELECT DISTINCT ON ("publishedContentId") "id", "publishedContentId"
      FROM "ContentMetricSnapshot"
     ORDER BY "publishedContentId", "capturedAt" DESC, "id" DESC
  ) l
 WHERE l."publishedContentId" = pc."id";
