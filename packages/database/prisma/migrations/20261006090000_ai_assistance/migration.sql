-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('READ_SCREENSHOT', 'SCRIPT_DRAFT', 'DRAFT_REVIEW', 'REPORT_SUMMARY');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('OK', 'REFUSED', 'FAILED');

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "sealedApiKey" TEXT,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 300,
    "readScreenshots" BOOLEAN NOT NULL DEFAULT true,
    "writingHelp" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "status" "AiRequestStatus" NOT NULL,
    "userId" TEXT,
    "campaignId" TEXT,
    "publishedContentId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRequest_createdAt_idx" ON "AiRequest"("createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_feature_createdAt_idx" ON "AiRequest"("feature", "createdAt");

