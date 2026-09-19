-- INT-4: opt-in encrypted provider-credential store.
-- NOTE: `prisma migrate dev` also proposed dropping the pg_trgm GIN indexes
-- created by the wave7 migration (Prisma cannot represent gin_trgm_ops, so it
-- reads them as drift). Those DROPs were removed by hand — the trigram indexes
-- must stay for directory search (W7-2/PERF-03). This migration only adds the
-- new table.

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "platform" "Platform",
    "sealed" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_key_key" ON "ProviderCredential"("key");
