-- INT-3: encrypted per-creator OAuth tokens (foundation; inert until app review).

-- CreateTable
CREATE TABLE "CreatorOAuthToken" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "sealedAccessToken" TEXT NOT NULL,
    "sealedRefreshToken" TEXT,
    "externalUserId" TEXT,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorOAuthToken_influencerId_platform_key" ON "CreatorOAuthToken"("influencerId", "platform");

-- CreateIndex
CREATE INDEX "CreatorOAuthToken_influencerId_idx" ON "CreatorOAuthToken"("influencerId");

-- AddForeignKey
ALTER TABLE "CreatorOAuthToken" ADD CONSTRAINT "CreatorOAuthToken_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
