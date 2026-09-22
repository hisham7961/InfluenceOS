-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "publishedContentId" TEXT;

-- AlterTable
ALTER TABLE "PublishedContent" ADD COLUMN     "isStory" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Attachment_publishedContentId_idx" ON "Attachment"("publishedContentId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
