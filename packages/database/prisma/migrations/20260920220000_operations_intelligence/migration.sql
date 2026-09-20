-- CreateEnum
CREATE TYPE "InspirationCategory" AS ENUM ('TREND', 'HOOK', 'UGC_STYLE', 'PRODUCT_DEMO', 'BEFORE_AFTER', 'EDUCATIONAL', 'STORYTELLING', 'VIRAL_FORMAT', 'COMPETITOR', 'AUDIO_TREND', 'OTHER');

-- CreateEnum
CREATE TYPE "InspirationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "NotificationCategory" ADD VALUE 'MENTION';
ALTER TYPE "NotificationCategory" ADD VALUE 'REPLY';
ALTER TYPE "NotificationCategory" ADD VALUE 'IMPORTANT_MESSAGE';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "channel" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deliverableId" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "inspirationItemId" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "shipmentId" TEXT;

-- CreateTable
CREATE TABLE "NoteMention" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReadState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspirationItem" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" "Platform",
    "thumbnailUrl" TEXT,
    "title" TEXT,
    "note" TEXT,
    "category" "InspirationCategory" NOT NULL DEFAULT 'OTHER',
    "tags" TEXT[],
    "brandId" TEXT,
    "campaignId" TEXT,
    "scriptReferenceId" TEXT,
    "status" "InspirationStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspirationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteMention_userId_createdAt_idx" ON "NoteMention"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NoteMention_noteId_userId_key" ON "NoteMention"("noteId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReadState_userId_conversationKey_key" ON "ConversationReadState"("userId", "conversationKey");

-- CreateIndex
CREATE INDEX "InspirationItem_brandId_idx" ON "InspirationItem"("brandId");

-- CreateIndex
CREATE INDEX "InspirationItem_campaignId_idx" ON "InspirationItem"("campaignId");

-- CreateIndex
CREATE INDEX "InspirationItem_status_idx" ON "InspirationItem"("status");

-- CreateIndex
CREATE INDEX "InspirationItem_createdAt_idx" ON "InspirationItem"("createdAt");

-- CreateIndex
CREATE INDEX "Note_campaignId_idx" ON "Note"("campaignId");

-- CreateIndex
CREATE INDEX "Note_deliverableId_idx" ON "Note"("deliverableId");

-- CreateIndex
CREATE INDEX "Note_shipmentId_idx" ON "Note"("shipmentId");

-- CreateIndex
CREATE INDEX "Note_inspirationItemId_idx" ON "Note"("inspirationItemId");

-- CreateIndex
CREATE INDEX "Note_channel_idx" ON "Note"("channel");

-- CreateIndex
CREATE INDEX "Note_parentId_idx" ON "Note"("parentId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ProductShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_inspirationItemId_fkey" FOREIGN KEY ("inspirationItemId") REFERENCES "InspirationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteMention" ADD CONSTRAINT "NoteMention_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteMention" ADD CONSTRAINT "NoteMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReadState" ADD CONSTRAINT "ConversationReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationItem" ADD CONSTRAINT "InspirationItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationItem" ADD CONSTRAINT "InspirationItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationItem" ADD CONSTRAINT "InspirationItem_scriptReferenceId_fkey" FOREIGN KEY ("scriptReferenceId") REFERENCES "ScriptReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspirationItem" ADD CONSTRAINT "InspirationItem_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

