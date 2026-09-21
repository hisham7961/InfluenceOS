-- CreateEnum
CREATE TYPE "RoleProfile" AS ENUM ('ADMIN', 'GENERAL_MANAGER', 'OPERATIONS_MANAGER', 'LOGISTICS', 'INFLUENCER_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Capability" AS ENUM ('USERS_MANAGE', 'ROLES_MANAGE', 'BRANDS_VIEW', 'BRANDS_MANAGE', 'CAMPAIGNS_VIEW', 'CAMPAIGNS_MANAGE', 'INFLUENCERS_VIEW', 'INFLUENCERS_MANAGE', 'CONTENT_VIEW', 'CONTENT_MANAGE', 'UGC_REVIEW', 'LOGISTICS_VIEW', 'LOGISTICS_MANAGE', 'LOGISTICS_ASSIGN', 'LOGISTICS_ADDRESS_VIEW', 'LOGISTICS_ADDRESS_EDIT', 'LOGISTICS_ISSUE_MANAGE', 'FINANCE_VIEW', 'FINANCE_MANAGE', 'REPORTS_VIEW', 'OPERATIONS_VIEW', 'SYSTEM_SETTINGS_MANAGE', 'INTEGRATIONS_MANAGE');

-- CreateEnum
CREATE TYPE "LogisticsIssueType" AS ENUM ('MISSING_ADDRESS', 'INCOMPLETE_ADDRESS', 'UNCLEAR_ADDRESS', 'MISSING_PHONE', 'INVALID_PHONE', 'MISSING_AREA_CITY', 'COUNTRY_MISMATCH', 'LOCATION_CLARIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "LogisticsIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'LOGISTICS_ADDRESS_ISSUE';

-- AlterTable
ALTER TABLE "Influencer" ADD COLUMN     "countryCode" TEXT;

-- AlterTable
ALTER TABLE "ProductShipment" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "destinationCountryCode" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roleProfile" "RoleProfile";

-- CreateTable
CREATE TABLE "UserCapability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capability" "Capability" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCountryAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCountryAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsIssue" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "type" "LogisticsIssueType" NOT NULL,
    "status" "LogisticsIssueStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "assignedToUserId" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LogisticsIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserCapability_userId_idx" ON "UserCapability"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCapability_userId_capability_key" ON "UserCapability"("userId", "capability");

-- CreateIndex
CREATE INDEX "UserCountryAccess_userId_idx" ON "UserCountryAccess"("userId");

-- CreateIndex
CREATE INDEX "UserCountryAccess_countryCode_idx" ON "UserCountryAccess"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserCountryAccess_userId_countryCode_key" ON "UserCountryAccess"("userId", "countryCode");

-- CreateIndex
CREATE INDEX "LogisticsIssue_shipmentId_idx" ON "LogisticsIssue"("shipmentId");

-- CreateIndex
CREATE INDEX "LogisticsIssue_status_idx" ON "LogisticsIssue"("status");

-- CreateIndex
CREATE INDEX "LogisticsIssue_assignedToUserId_idx" ON "LogisticsIssue"("assignedToUserId");

-- CreateIndex
CREATE INDEX "Influencer_countryCode_idx" ON "Influencer"("countryCode");

-- CreateIndex
CREATE INDEX "ProductShipment_destinationCountryCode_idx" ON "ProductShipment"("destinationCountryCode");

-- CreateIndex
CREATE INDEX "ProductShipment_assignedToUserId_idx" ON "ProductShipment"("assignedToUserId");

-- CreateIndex
CREATE INDEX "User_roleProfile_idx" ON "User"("roleProfile");

-- AddForeignKey
ALTER TABLE "UserCapability" ADD CONSTRAINT "UserCapability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCountryAccess" ADD CONSTRAINT "UserCountryAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductShipment" ADD CONSTRAINT "ProductShipment_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsIssue" ADD CONSTRAINT "LogisticsIssue_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ProductShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsIssue" ADD CONSTRAINT "LogisticsIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsIssue" ADD CONSTRAINT "LogisticsIssue_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsIssue" ADD CONSTRAINT "LogisticsIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill: best-effort, conservative normalization of existing
-- free-text country values to canonical ISO 3166-1 alpha-2 codes. Only
-- exact, unambiguous case-insensitive name matches are backfilled; anything
-- else is left NULL rather than guessed — the free-text "country" column is
-- never touched or destroyed.
UPDATE "Influencer" SET "countryCode" = 'KW' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('kuwait', 'kw');
UPDATE "Influencer" SET "countryCode" = 'SA' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('saudi arabia', 'ksa', 'sa');
UPDATE "Influencer" SET "countryCode" = 'AE' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('uae', 'united arab emirates', 'ae');
UPDATE "Influencer" SET "countryCode" = 'QA' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('qatar', 'qa');
UPDATE "Influencer" SET "countryCode" = 'BH' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('bahrain', 'bh');
UPDATE "Influencer" SET "countryCode" = 'OM' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('oman', 'om');
UPDATE "Influencer" SET "countryCode" = 'EG' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('egypt', 'eg');
UPDATE "Influencer" SET "countryCode" = 'JO' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('jordan', 'jo');
UPDATE "Influencer" SET "countryCode" = 'LB' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('lebanon', 'lb');
UPDATE "Influencer" SET "countryCode" = 'US' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('united states', 'usa', 'us', 'united states of america');
UPDATE "Influencer" SET "countryCode" = 'GB' WHERE "countryCode" IS NULL AND lower(trim("country")) IN ('united kingdom', 'uk', 'gb', 'great britain');

UPDATE "ProductShipment" SET "destinationCountryCode" = 'KW' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('kuwait', 'kw');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'SA' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('saudi arabia', 'ksa', 'sa');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'AE' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('uae', 'united arab emirates', 'ae');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'QA' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('qatar', 'qa');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'BH' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('bahrain', 'bh');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'OM' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('oman', 'om');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'EG' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('egypt', 'eg');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'JO' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('jordan', 'jo');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'LB' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('lebanon', 'lb');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'US' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('united states', 'usa', 'us', 'united states of america');
UPDATE "ProductShipment" SET "destinationCountryCode" = 'GB' WHERE "destinationCountryCode" IS NULL AND lower(trim("country")) IN ('united kingdom', 'uk', 'gb', 'great britain');
