-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'LICENCE_EXPIRING';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "marketCountryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ClientConfig" ADD COLUMN     "licenceCountryCodes" TEXT[] DEFAULT ARRAY['KW', 'SA', 'AE']::TEXT[];

-- CreateTable
CREATE TABLE "CreatorLicence" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "authority" TEXT,
    "number" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "attachmentId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "expiryRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorLicence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorLicence_expiresAt_idx" ON "CreatorLicence"("expiresAt");

-- CreateIndex
CREATE INDEX "CreatorLicence_attachmentId_idx" ON "CreatorLicence"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorLicence_influencerId_countryCode_key" ON "CreatorLicence"("influencerId", "countryCode");

-- AddForeignKey
ALTER TABLE "CreatorLicence" ADD CONSTRAINT "CreatorLicence_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLicence" ADD CONSTRAINT "CreatorLicence_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLicence" ADD CONSTRAINT "CreatorLicence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: turn the free-text target market into countries where the text
-- plainly names them. Anything else stays empty for the team to set.
UPDATE "Campaign" SET "marketCountryCodes" = CASE lower(btrim("targetMarket"))
    WHEN 'kuwait' THEN ARRAY['KW']
    WHEN 'kw' THEN ARRAY['KW']
    WHEN 'الكويت' THEN ARRAY['KW']
    WHEN 'saudi arabia' THEN ARRAY['SA']
    WHEN 'saudi' THEN ARRAY['SA']
    WHEN 'ksa' THEN ARRAY['SA']
    WHEN 'السعودية' THEN ARRAY['SA']
    WHEN 'uae' THEN ARRAY['AE']
    WHEN 'united arab emirates' THEN ARRAY['AE']
    WHEN 'الإمارات' THEN ARRAY['AE']
    WHEN 'الامارات' THEN ARRAY['AE']
    WHEN 'qatar' THEN ARRAY['QA']
    WHEN 'قطر' THEN ARRAY['QA']
    WHEN 'bahrain' THEN ARRAY['BH']
    WHEN 'البحرين' THEN ARRAY['BH']
    WHEN 'oman' THEN ARRAY['OM']
    WHEN 'عمان' THEN ARRAY['OM']
    WHEN 'عُمان' THEN ARRAY['OM']
    WHEN 'gcc' THEN ARRAY['KW', 'SA', 'AE', 'QA', 'BH', 'OM']
    WHEN 'الخليج' THEN ARRAY['KW', 'SA', 'AE', 'QA', 'BH', 'OM']
    ELSE "marketCountryCodes"
  END
WHERE "targetMarket" IS NOT NULL;
