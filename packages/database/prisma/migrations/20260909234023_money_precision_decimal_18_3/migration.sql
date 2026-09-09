-- AlterTable
ALTER TABLE "BrandInfluencer" ALTER COLUMN "defaultRate" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "plannedBudget" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "CampaignExpense" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "CampaignInfluencer" ALTER COLUMN "agreedCost" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "giftedProductValue" SET DATA TYPE DECIMAL(18,3);
