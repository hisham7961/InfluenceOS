-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('IMPORT', 'MANUAL');

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeKey" TEXT NOT NULL,
    "discount" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLinkClickDay" (
    "linkId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrackingLinkClickDay_pkey" PRIMARY KEY ("linkId","day")
);

-- CreateTable
CREATE TABLE "SalesImport" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "fileName" TEXT,
    "rowCount" INTEGER NOT NULL,
    "imported" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "unmatched" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "promoCodeId" TEXT,
    "trackingLinkId" TEXT,
    "importId" TEXT,
    "source" "SaleSource" NOT NULL,
    "orderRef" TEXT,
    "orders" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoCode_brandId_codeKey_idx" ON "PromoCode"("brandId", "codeKey");

-- CreateIndex
CREATE INDEX "PromoCode_influencerId_idx" ON "PromoCode"("influencerId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_campaignId_codeKey_key" ON "PromoCode"("campaignId", "codeKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_slug_key" ON "TrackingLink"("slug");

-- CreateIndex
CREATE INDEX "TrackingLink_campaignId_idx" ON "TrackingLink"("campaignId");

-- CreateIndex
CREATE INDEX "TrackingLink_influencerId_idx" ON "TrackingLink"("influencerId");

-- CreateIndex
CREATE INDEX "SalesImport_brandId_createdAt_idx" ON "SalesImport"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_campaignId_occurredAt_idx" ON "Sale"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "Sale_influencerId_occurredAt_idx" ON "Sale"("influencerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Sale_brandId_occurredAt_idx" ON "Sale"("brandId", "occurredAt");

-- CreateIndex
CREATE INDEX "Sale_importId_idx" ON "Sale"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_brandId_orderRef_key" ON "Sale"("brandId", "orderRef");

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLinkClickDay" ADD CONSTRAINT "TrackingLinkClickDay_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackingLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImport" ADD CONSTRAINT "SalesImport_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImport" ADD CONSTRAINT "SalesImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "TrackingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

