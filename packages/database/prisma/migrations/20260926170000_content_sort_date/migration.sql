-- One date to sort content by: when it was published, or when it was found
-- if the publish date is unknown. A trigger keeps it in step with
-- publishedAt/detectedAt on every insert and update, whoever writes them
-- (API, worker, imports), so the app never has to remember to set it.
ALTER TABLE "PublishedContent" ADD COLUMN "sortAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "PublishedContent" SET "sortAt" = COALESCE("publishedAt", "detectedAt");

CREATE OR REPLACE FUNCTION published_content_sort_at() RETURNS trigger AS $$
BEGIN
  NEW."sortAt" := COALESCE(NEW."publishedAt", NEW."detectedAt");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER published_content_sort_at
  BEFORE INSERT OR UPDATE OF "publishedAt", "detectedAt", "sortAt" ON "PublishedContent"
  FOR EACH ROW EXECUTE FUNCTION published_content_sort_at();

CREATE INDEX "PublishedContent_sortAt_id_idx" ON "PublishedContent"("sortAt", "id");
