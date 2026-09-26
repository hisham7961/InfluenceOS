-- Post covers kept in our own storage (the platforms' CDN links expire).
ALTER TABLE "PublishedContent" ADD COLUMN "coverKey" TEXT;
ALTER TABLE "PublishedContent" ADD COLUMN "coverTries" INTEGER NOT NULL DEFAULT 0;
