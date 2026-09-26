-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "reportSummary" TEXT,
ADD COLUMN     "targetCostPerView" DECIMAL(18,6),
ADD COLUMN     "targetEngagementRate" DOUBLE PRECISION,
ADD COLUMN     "targetEngagements" INTEGER,
ADD COLUMN     "targetViews" INTEGER;

