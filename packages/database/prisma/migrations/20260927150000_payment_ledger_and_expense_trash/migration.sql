-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'PAYMENT_LINK', 'OTHER');

-- AlterTable
ALTER TABLE "CampaignExpense" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignInfluencerId" TEXT,
    "expenseId" TEXT,
    "amount" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "receiptId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_campaignId_idx" ON "Payment"("campaignId");

-- CreateIndex
CREATE INDEX "Payment_campaignInfluencerId_idx" ON "Payment"("campaignInfluencerId");

-- CreateIndex
CREATE INDEX "Payment_expenseId_idx" ON "Payment"("expenseId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_receiptId_idx" ON "Payment"("receiptId");

-- CreateIndex
CREATE INDEX "CampaignExpense_deletedAt_idx" ON "CampaignExpense"("deletedAt");

-- AddForeignKey
ALTER TABLE "CampaignExpense" ADD CONSTRAINT "CampaignExpense_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "CampaignExpense"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: what was already recorded as paid becomes the first ledger entry,
-- for exactly the amount the money rules counted (paid in full = the whole
-- fee/amount; a part payment = its recorded amount, never more than the
-- whole). A part payment of unknown amount has nothing to carry over and
-- stays as it was until its first payment is recorded.
INSERT INTO "Payment" ("id", "campaignId", "campaignInfluencerId", "amount", "currency", "paidAt", "method", "notes", "createdAt")
SELECT gen_random_uuid()::text, ci."campaignId", ci."id",
       CASE WHEN ci."paymentStatus" = 'PAID' THEN ci."agreedCost" ELSE LEAST(ci."paidAmount", ci."agreedCost") END,
       COALESCE(ci."currency", c."currency"),
       COALESCE(ci."paidAt", ci."updatedAt"),
       'OTHER', 'Recorded before the payment ledger', CURRENT_TIMESTAMP
FROM "CampaignInfluencer" ci
JOIN "Campaign" c ON c."id" = ci."campaignId"
WHERE ci."agreedCost" > 0
  AND (ci."paymentStatus" = 'PAID' OR (ci."paymentStatus" = 'PARTIALLY_PAID' AND ci."paidAmount" > 0));

INSERT INTO "Payment" ("id", "campaignId", "expenseId", "amount", "currency", "paidAt", "method", "notes", "createdById", "createdAt")
SELECT gen_random_uuid()::text, e."campaignId", e."id",
       CASE WHEN e."paymentStatus" = 'PAID' THEN e."amount" ELSE LEAST(e."paidAmount", e."amount") END,
       e."currency",
       COALESCE(e."paidAt", e."incurredAt", e."updatedAt"),
       'OTHER', 'Recorded before the payment ledger', e."createdById", CURRENT_TIMESTAMP
FROM "CampaignExpense" e
WHERE e."amount" > 0
  AND (e."paymentStatus" = 'PAID' OR (e."paymentStatus" = 'PARTIALLY_PAID' AND e."paidAmount" > 0));
