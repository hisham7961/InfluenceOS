-- CreateEnum
CREATE TYPE "UsageRightType" AS ENUM ('ORGANIC', 'PAID_ADS', 'WHITELISTING', 'BROADCAST', 'OTHER');

-- CreateEnum
CREATE TYPE "UsageRightStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'USAGE_RIGHT_EXPIRING';

-- CreateTable
CREATE TABLE "UsageRight" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT,
    "influencerId" TEXT,
    "publishedContentId" TEXT,
    "usageType" "UsageRightType" NOT NULL DEFAULT 'ORGANIC',
    "scope" TEXT,
    "territory" TEXT,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "competitorRestriction" TEXT,
    "disclosureRequired" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" "UsageRightStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageRight_brandId_idx" ON "UsageRight"("brandId");

-- CreateIndex
CREATE INDEX "UsageRight_campaignId_idx" ON "UsageRight"("campaignId");

-- CreateIndex
CREATE INDEX "UsageRight_influencerId_idx" ON "UsageRight"("influencerId");

-- CreateIndex
CREATE INDEX "UsageRight_expiresAt_idx" ON "UsageRight"("expiresAt");

-- CreateIndex
CREATE INDEX "UsageRight_status_idx" ON "UsageRight"("status");

-- AddForeignKey
ALTER TABLE "UsageRight" ADD CONSTRAINT "UsageRight_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRight" ADD CONSTRAINT "UsageRight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRight" ADD CONSTRAINT "UsageRight_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRight" ADD CONSTRAINT "UsageRight_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRight" ADD CONSTRAINT "UsageRight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
