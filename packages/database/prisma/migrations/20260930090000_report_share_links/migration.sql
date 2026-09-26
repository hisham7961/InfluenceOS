-- CreateTable
CREATE TABLE "ReportShareLink" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "includeCosts" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportShareLink_tokenHash_key" ON "ReportShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ReportShareLink_campaignId_createdAt_idx" ON "ReportShareLink"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportShareLink" ADD CONSTRAINT "ReportShareLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShareLink" ADD CONSTRAINT "ReportShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

