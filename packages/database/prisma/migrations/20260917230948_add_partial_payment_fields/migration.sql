-- AlterTable
ALTER TABLE "CampaignExpense" ADD COLUMN     "paidAmount" DECIMAL(18,3),
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignInfluencer" ADD COLUMN     "paidAmount" DECIMAL(18,3),
ADD COLUMN     "paidAt" TIMESTAMP(3);
