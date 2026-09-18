-- CreateTable
CREATE TABLE "UserBrandAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBrandAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserBrandAccess_userId_idx" ON "UserBrandAccess"("userId");

-- CreateIndex
CREATE INDEX "UserBrandAccess_brandId_idx" ON "UserBrandAccess"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBrandAccess_userId_brandId_key" ON "UserBrandAccess"("userId", "brandId");

-- AddForeignKey
ALTER TABLE "UserBrandAccess" ADD CONSTRAINT "UserBrandAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBrandAccess" ADD CONSTRAINT "UserBrandAccess_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
