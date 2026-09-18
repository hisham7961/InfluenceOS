-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('CONSIDERING', 'SHORTLISTED', 'APPROVED', 'REJECTED', 'CONVERTED');

-- CreateTable
CREATE TABLE "CampaignCandidate" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'CONSIDERING',
    "fitScore" INTEGER,
    "notes" TEXT,
    "decisionReason" TEXT,
    "addedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "convertedCampaignInfluencerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignCandidate_campaignId_idx" ON "CampaignCandidate"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignCandidate_influencerId_idx" ON "CampaignCandidate"("influencerId");

-- CreateIndex
CREATE INDEX "CampaignCandidate_status_idx" ON "CampaignCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCandidate_campaignId_influencerId_key" ON "CampaignCandidate"("campaignId", "influencerId");

-- AddForeignKey
ALTER TABLE "CampaignCandidate" ADD CONSTRAINT "CampaignCandidate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCandidate" ADD CONSTRAINT "CampaignCandidate_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCandidate" ADD CONSTRAINT "CampaignCandidate_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCandidate" ADD CONSTRAINT "CampaignCandidate_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
