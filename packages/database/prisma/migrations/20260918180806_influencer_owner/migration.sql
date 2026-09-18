-- AlterTable
ALTER TABLE "Influencer" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Influencer_ownerId_idx" ON "Influencer"("ownerId");

-- AddForeignKey
ALTER TABLE "Influencer" ADD CONSTRAINT "Influencer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
