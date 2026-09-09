-- AlterTable
ALTER TABLE "DeviceSession" ADD COLUMN     "prevRefreshTokenHash" TEXT,
ADD COLUMN     "refreshRotatedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT;
