-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'FAILED');

-- CreateTable
CREATE TABLE "ProductShipment" (
    "id" TEXT NOT NULL,
    "campaignInfluencerId" TEXT NOT NULL,
    "recipientName" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "courier" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductShipment_campaignInfluencerId_key" ON "ProductShipment"("campaignInfluencerId");

-- CreateIndex
CREATE INDEX "ProductShipment_status_idx" ON "ProductShipment"("status");

-- AddForeignKey
ALTER TABLE "ProductShipment" ADD CONSTRAINT "ProductShipment_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductShipment" ADD CONSTRAINT "ProductShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
