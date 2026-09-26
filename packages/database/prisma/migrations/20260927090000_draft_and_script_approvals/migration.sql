-- CreateEnum
CREATE TYPE "ScriptVersionStatus" AS ENUM ('DRAFT', 'SENT_TO_BRAND', 'CHANGES_REQUESTED', 'APPROVED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "campaignInfluencerId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "draftReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DeliverableSubmission" ADD COLUMN     "attachmentId" TEXT,
ADD COLUMN     "caption" TEXT;

-- AlterTable
ALTER TABLE "ScriptReference" ADD COLUMN     "approvedVersion" INTEGER;

-- AlterTable
ALTER TABLE "ScriptReferenceVersion" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "ScriptVersionStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "Attachment_campaignInfluencerId_idx" ON "Attachment"("campaignInfluencerId");

-- CreateIndex
CREATE INDEX "DeliverableSubmission_attachmentId_idx" ON "DeliverableSubmission"("attachmentId");

-- AddForeignKey
ALTER TABLE "DeliverableSubmission" ADD CONSTRAINT "DeliverableSubmission_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptReferenceVersion" ADD CONSTRAINT "ScriptReferenceVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

