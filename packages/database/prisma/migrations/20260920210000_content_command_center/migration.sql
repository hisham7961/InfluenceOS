-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'SHIPMENT_DELIVERED';
ALTER TYPE "NotificationCategory" ADD VALUE 'SUBMISSION_APPROVED';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "publishedContentId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "contentLayout" TEXT,
ADD COLUMN     "lastWhatsNewViewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserContentState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publishedContentId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "savedForLaterAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserContentState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserContentState_userId_reviewedAt_idx" ON "UserContentState"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "UserContentState_userId_savedForLaterAt_idx" ON "UserContentState"("userId", "savedForLaterAt");

-- CreateIndex
CREATE INDEX "UserContentState_publishedContentId_idx" ON "UserContentState"("publishedContentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserContentState_userId_publishedContentId_key" ON "UserContentState"("userId", "publishedContentId");

-- CreateIndex
CREATE INDEX "Note_publishedContentId_idx" ON "Note"("publishedContentId");

-- AddForeignKey
ALTER TABLE "UserContentState" ADD CONSTRAINT "UserContentState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserContentState" ADD CONSTRAINT "UserContentState_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
