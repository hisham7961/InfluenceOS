




DROP INDEX "ProductShipment_campaignInfluencerId_key";

-- AlterTable
ALTER TABLE "Deliverable" ADD COLUMN     "requiresProduct" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Influencer" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "deliveryInstructions" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "ProductShipment" ADD COLUMN     "deliverableId" TEXT,
ADD COLUMN     "deliveryInstructions" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "variant" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_brandId_name_key" ON "Product"("brandId", "name");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentItem_productId_idx" ON "ShipmentItem"("productId");

-- CreateIndex
CREATE INDEX "ProductShipment_campaignInfluencerId_idx" ON "ProductShipment"("campaignInfluencerId");

-- CreateIndex
CREATE INDEX "ProductShipment_deliverableId_idx" ON "ProductShipment"("deliverableId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ProductShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductShipment" ADD CONSTRAINT "ProductShipment_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

