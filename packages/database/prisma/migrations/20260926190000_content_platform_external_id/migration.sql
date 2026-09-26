-- The same post reached through a different link (x.com vs twitter.com, an
-- Instagram link with the username in it) is matched on its post id.
CREATE INDEX "PublishedContent_platform_externalId_idx" ON "PublishedContent"("platform", "externalId");
