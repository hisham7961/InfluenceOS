-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('DAILY', 'WEEKLY', 'OFF');

-- AlterTable
ALTER TABLE "Deliverable" ADD COLUMN     "dueSoonRemindedAt" TIMESTAMP(3),
ADD COLUMN     "overdueRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "emailCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'DAILY',
ADD COLUMN     "emailCategories" "NotificationCategory"[] DEFAULT ARRAY['CONTENT_REMOVED', 'MENTION']::"NotificationCategory"[],
ADD COLUMN     "lastDigestAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("userId","notificationId")
);

-- CreateIndex
CREATE INDEX "NotificationRead_notificationId_idx" ON "NotificationRead"("notificationId");

-- CreateIndex
CREATE INDEX "Notification_dedupeKey_idx" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_emailCheckedAt_createdAt_idx" ON "Notification"("emailCheckedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data (P2.6)
-- ---------------------------------------------------------------------------

-- Notifications that already exist are never emailed: only ones created from
-- now on go through the email step.
UPDATE "Notification" SET "emailCheckedAt" = "createdAt" WHERE "emailCheckedAt" IS NULL;

-- Usage-rights expiry alerts linked to a page that doesn't exist
-- (/brands/<id>/usage-rights/<id>). Point them at the brand's usage-rights
-- card, and give them the key the worker now de-duplicates on.
UPDATE "Notification" n
SET "dedupeKey" = 'usage-right-expiring:' || ur."id" || ':' || to_char(ur."expiresAt", 'YYYY-MM-DD'),
    "targetUrl" = '/brands/' || ur."brandId" || '#usage-rights'
FROM "UsageRight" ur
WHERE n."category" = 'USAGE_RIGHT_EXPIRING'
  AND n."targetUrl" = '/brands/' || ur."brandId" || '/usage-rights/' || ur."id"
  AND ur."expiresAt" IS NOT NULL;
UPDATE "Notification"
SET "targetUrl" = regexp_replace("targetUrl", '^/brands/([^/]+)/usage-rights/[^/?#]+$', '/brands/\1#usage-rights')
WHERE "targetUrl" ~ '^/brands/[^/]+/usage-rights/[^/?#]+$';

-- Trend mentions linked to /inspiration/<id>, which doesn't exist; the
-- Inspiration page opens an item from ?item=<id>.
UPDATE "Notification"
SET "targetUrl" = regexp_replace("targetUrl", '^/inspiration/([^/?#]+)$', '/inspiration?item=\1')
WHERE "targetUrl" ~ '^/inspiration/[^/?#]+$';

-- Campaign-ending alerts already sent keep counting as sent.
UPDATE "Notification" n
SET "dedupeKey" = 'campaign-ending:' || c."id" || ':' || to_char(c."endDate", 'YYYY-MM-DD')
FROM "Campaign" c
WHERE n."category" = 'CAMPAIGN_ENDING' AND n."campaignId" = c."id" AND c."endDate" IS NOT NULL;

-- Reminders used to be one per campaign; they are now one per deliverable.
-- Deliverables in a campaign that was reminded recently count as reminded
-- then, so the first run after this change doesn't re-send all of them.
UPDATE "Deliverable" d
SET "overdueRemindedAt" = r."latest"
FROM (
  SELECT "campaignId", max("createdAt") AS "latest" FROM "Notification"
  WHERE "category" = 'DELIVERABLE_OVERDUE' AND "campaignId" IS NOT NULL
  GROUP BY "campaignId"
) r, "CampaignInfluencer" ci
WHERE d."campaignInfluencerId" = ci."id" AND ci."campaignId" = r."campaignId";
UPDATE "Deliverable" d
SET "dueSoonRemindedAt" = r."latest"
FROM (
  SELECT "campaignId", max("createdAt") AS "latest" FROM "Notification"
  WHERE "category" = 'DELIVERABLE_DUE_SOON' AND "campaignId" IS NOT NULL
  GROUP BY "campaignId"
) r, "CampaignInfluencer" ci
WHERE d."campaignInfluencerId" = ci."id" AND ci."campaignId" = r."campaignId";
