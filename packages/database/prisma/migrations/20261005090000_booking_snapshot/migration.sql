-- AlterTable
ALTER TABLE "CampaignInfluencer" ADD COLUMN     "followersAtBooking" INTEGER,
ADD COLUMN     "platformAtBooking" "Platform";

-- CreateIndex
CREATE INDEX "CampaignInfluencer_platformAtBooking_followersAtBooking_idx" ON "CampaignInfluencer"("platformAtBooking", "followersAtBooking");


-- Backfill: bookings made before this change take the creator's main account
-- as it is now (their primary platform's account, else their biggest one).
UPDATE "CampaignInfluencer" ci
SET "platformAtBooking" = pick."platform", "followersAtBooking" = pick."followers"
FROM (
  SELECT DISTINCT ON (sa."influencerId") sa."influencerId", sa."platform", sa."followers"
  FROM "SocialAccount" sa
  JOIN "Influencer" i ON i."id" = sa."influencerId"
  ORDER BY sa."influencerId",
           (sa."platform" = i."primaryPlatform") DESC NULLS LAST,
           sa."isPrimary" DESC,
           sa."followers" DESC NULLS LAST
) pick
WHERE pick."influencerId" = ci."influencerId" AND ci."platformAtBooking" IS NULL;
