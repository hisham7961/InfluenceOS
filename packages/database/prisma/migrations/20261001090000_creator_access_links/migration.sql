-- AlterTable
ALTER TABLE "Deliverable" ADD COLUMN     "creatorPostUrl" TEXT,
ADD COLUMN     "creatorPostedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DeliverableSubmission" ADD COLUMN     "fromCreator" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CreatorAccessLink" (
    "id" TEXT NOT NULL,
    "campaignInfluencerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorAccessLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAccessLink_tokenHash_key" ON "CreatorAccessLink"("tokenHash");

-- CreateIndex
CREATE INDEX "CreatorAccessLink_campaignInfluencerId_createdAt_idx" ON "CreatorAccessLink"("campaignInfluencerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreatorAccessLink" ADD CONSTRAINT "CreatorAccessLink_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAccessLink" ADD CONSTRAINT "CreatorAccessLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

