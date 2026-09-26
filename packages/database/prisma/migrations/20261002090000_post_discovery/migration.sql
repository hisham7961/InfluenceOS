-- CreateEnum
CREATE TYPE "DiscoveredPostStatus" AS ENUM ('NEW', 'ADDED', 'DISMISSED');

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "lastDiscoveryAt" TIMESTAMP(3),
ADD COLUMN     "lastDiscoveryError" TEXT;

-- CreateTable
CREATE TABLE "DiscoveredPost" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "postedAt" TIMESTAMP(3),
    "mediaType" TEXT,
    "influencerId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "campaignId" TEXT NOT NULL,
    "campaignInfluencerId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "signals" TEXT[],
    "status" "DiscoveredPostStatus" NOT NULL DEFAULT 'NEW',
    "publishedContentId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredPost_publishedContentId_key" ON "DiscoveredPost"("publishedContentId");

-- CreateIndex
CREATE INDEX "DiscoveredPost_campaignId_status_idx" ON "DiscoveredPost"("campaignId", "status");

-- CreateIndex
CREATE INDEX "DiscoveredPost_status_foundAt_idx" ON "DiscoveredPost"("status", "foundAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredPost_platform_externalId_key" ON "DiscoveredPost"("platform", "externalId");

-- CreateIndex
CREATE INDEX "SocialAccount_lastDiscoveryAt_idx" ON "SocialAccount"("lastDiscoveryAt");

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPost" ADD CONSTRAINT "DiscoveredPost_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

