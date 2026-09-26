-- CreateEnum
CREATE TYPE "CreatorGender" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "AudienceSource" AS ENUM ('MANUAL', 'CREATOR', 'PLATFORM');

-- AlterTable
ALTER TABLE "Influencer" ADD COLUMN     "gender" "CreatorGender",
ADD COLUMN     "rateCurrency" TEXT,
ADD COLUMN     "rateMax" DECIMAL(18,3),
ADD COLUMN     "rateMin" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "engagementRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "AudienceInsight" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "source" "AudienceSource" NOT NULL DEFAULT 'MANUAL',
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "femalePct" DOUBLE PRECISION,
    "malePct" DOUBLE PRECISION,
    "age13to17Pct" DOUBLE PRECISION,
    "age18to24Pct" DOUBLE PRECISION,
    "age25to34Pct" DOUBLE PRECISION,
    "age35to44Pct" DOUBLE PRECISION,
    "age45PlusPct" DOUBLE PRECISION,
    "engagementRate" DOUBLE PRECISION,
    "attachmentId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceCountryShare" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "pct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AudienceCountryShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudienceInsight_socialAccountId_capturedAt_idx" ON "AudienceInsight"("socialAccountId", "capturedAt");

-- CreateIndex
CREATE INDEX "AudienceInsight_isLatest_idx" ON "AudienceInsight"("isLatest");

-- CreateIndex
CREATE INDEX "AudienceInsight_attachmentId_idx" ON "AudienceInsight"("attachmentId");

-- CreateIndex
CREATE INDEX "AudienceCountryShare_countryCode_pct_idx" ON "AudienceCountryShare"("countryCode", "pct");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceCountryShare_insightId_countryCode_key" ON "AudienceCountryShare"("insightId", "countryCode");

-- CreateIndex
CREATE INDEX "Influencer_gender_idx" ON "Influencer"("gender");

-- CreateIndex
CREATE INDEX "SocialAccount_engagementRate_idx" ON "SocialAccount"("engagementRate");

-- AddForeignKey
ALTER TABLE "AudienceInsight" ADD CONSTRAINT "AudienceInsight_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceInsight" ADD CONSTRAINT "AudienceInsight_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceInsight" ADD CONSTRAINT "AudienceInsight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceCountryShare" ADD CONSTRAINT "AudienceCountryShare_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "AudienceInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: each account's engagement rate from its newest snapshot that has one.
UPDATE "SocialAccount" sa
SET "engagementRate" = s."engagementRate"
FROM (
  SELECT DISTINCT ON ("socialAccountId") "socialAccountId", "engagementRate"
  FROM "SocialMetricSnapshot"
  WHERE "engagementRate" IS NOT NULL
  ORDER BY "socialAccountId", "capturedAt" DESC
) s
WHERE s."socialAccountId" = sa."id";
