-- Worker account-sync backoff: record every attempt and the last failure.
ALTER TABLE "SocialAccount" ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT;
