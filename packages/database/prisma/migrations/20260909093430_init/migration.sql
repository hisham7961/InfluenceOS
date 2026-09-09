-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'SNAPCHAT', 'X');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('MANUAL', 'OFFICIAL_API', 'EMBED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('PROSPECT', 'CONTACTED', 'NEGOTIATING', 'ACTIVE', 'RECURRING', 'PAST', 'DECLINED', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE', 'INSTAGRAM_DM', 'OTHER');

-- CreateEnum
CREATE TYPE "AudienceHealthLabel" AS ENUM ('HEALTHY', 'REVIEW', 'LIMITED_DATA');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignObjective" AS ENUM ('AWARENESS', 'ENGAGEMENT', 'CONVERSIONS', 'LAUNCH', 'UGC', 'OTHER');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('FREE', 'PAID', 'GIFTED_PRODUCT', 'PAID_PLUS_GIFTED');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('INVITED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'DROPPED');

-- CreateEnum
CREATE TYPE "DeliverableType" AS ENUM ('POST', 'STORY', 'REEL', 'SHORT', 'VIDEO', 'LIVE', 'TWEET', 'SNAP', 'CAROUSEL', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION', 'PUBLISHED', 'VERIFIED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('LIVE', 'REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_APPLICABLE', 'UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('INFLUENCER_FEE', 'GIFT_PRODUCT', 'PRODUCTION', 'ADS', 'SHIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('CONTENT_REMOVED', 'CONTENT_UNAVAILABLE', 'DELIVERABLE_OVERDUE', 'DELIVERABLE_DUE_SOON', 'CAMPAIGN_ENDING', 'SYNC_FAILURE', 'NEW_CONTENT', 'FOLLOWER_MILESTONE', 'GENERAL');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('BRAND_CREATED', 'BRAND_UPDATED', 'INFLUENCER_ADDED', 'INFLUENCER_UPDATED', 'SOCIAL_ACCOUNT_ADDED', 'INFLUENCER_ADDED_TO_CAMPAIGN', 'CAMPAIGN_CREATED', 'CAMPAIGN_STATUS_CHANGED', 'CAMPAIGN_UPDATED', 'DELIVERABLE_ADDED', 'DELIVERABLE_STATUS_CHANGED', 'SCRIPT_ADDED', 'SCRIPT_UPDATED', 'CONTENT_PUBLISHED', 'CONTENT_STATUS_CHANGED', 'COST_ADDED', 'COST_UPDATED', 'NOTE_ADDED', 'FOLLOWER_MILESTONE', 'GENERIC');

-- CreateEnum
CREATE TYPE "MonitoringEventType" AS ENUM ('CHECK_OK', 'STATUS_CHANGED', 'CHECK_FAILED', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ENABLED', 'DISABLED', 'NOT_CONFIGURED', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "iconUrl" TEXT,
    "coverUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#6366F1',
    "accentColor" TEXT,
    "secondaryColor" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Influencer" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "fullName" TEXT,
    "primaryUsername" TEXT,
    "primaryPlatform" "Platform",
    "avatarOverrideUrl" TEXT,
    "resolvedAvatarUrl" TEXT,
    "bio" TEXT,
    "country" TEXT,
    "city" TEXT,
    "category" TEXT,
    "languages" TEXT[],
    "email" TEXT,
    "mobile" TEXT,
    "whatsapp" TEXT,
    "managerName" TEXT,
    "managerContact" TEXT,
    "preferredContact" "ContactMethod",
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "relationshipStatus" "RelationshipStatus" NOT NULL DEFAULT 'PROSPECT',
    "audienceHealth" "AudienceHealthLabel" NOT NULL DEFAULT 'LIMITED_DATA',
    "pricingNotes" TEXT,
    "internalNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "username" TEXT NOT NULL,
    "profileUrl" TEXT,
    "platformUserId" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "followers" INTEGER,
    "following" INTEGER,
    "postCount" INTEGER,
    "isVerified" BOOLEAN,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "lastSyncedAt" TIMESTAMP(3),
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMetricSnapshot" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "followers" INTEGER,
    "following" INTEGER,
    "postCount" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "SocialMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandInfluencer" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "relationshipStatus" "RelationshipStatus" NOT NULL DEFAULT 'PROSPECT',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "internalNotes" TEXT,
    "defaultRate" DECIMAL(14,2),
    "currency" TEXT,
    "firstCollaborationAt" TIMESTAMP(3),
    "lastCampaignAt" TIMESTAMP(3),
    "totalCollaborations" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandInfluencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coverUrl" TEXT,
    "description" TEXT,
    "brief" TEXT,
    "objective" "CampaignObjective",
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'KWD',
    "plannedBudget" DECIMAL(14,2),
    "targetMarket" TEXT,
    "ownerId" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignInfluencer" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "dealType" "DealType" NOT NULL DEFAULT 'PAID',
    "agreedCost" DECIMAL(14,2),
    "currency" TEXT,
    "giftedProductValue" DECIMAL(14,2),
    "dateContacted" TIMESTAMP(3),
    "expectedPublishAt" TIMESTAMP(3),
    "participationStatus" "ParticipationStatus" NOT NULL DEFAULT 'INVITED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignInfluencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "campaignInfluencerId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "type" "DeliverableType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "dueDate" TIMESTAMP(3),
    "requirements" TEXT,
    "requiredHashtags" TEXT[],
    "requiredMentions" TEXT[],
    "scriptReferenceId" TEXT,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'PLANNED',
    "publishedUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptReference" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptReferenceVersion" (
    "id" TEXT NOT NULL,
    "scriptReferenceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT,
    "captionSuggestion" TEXT,
    "talkingPoints" TEXT[],
    "dos" TEXT[],
    "donts" TEXT[],
    "requiredClaims" TEXT[],
    "hashtags" TEXT[],
    "mentions" TEXT[],
    "referenceLinks" TEXT[],
    "internalComments" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptReferenceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedContent" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT,
    "originalUrl" TEXT NOT NULL,
    "embedUrl" TEXT,
    "embedConfig" JSONB,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "publishedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brandId" TEXT,
    "campaignId" TEXT,
    "influencerId" TEXT,
    "campaignInfluencerId" TEXT,
    "deliverableId" TEXT,
    "availabilityStatus" "ContentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "lastMetricsSyncAt" TIMESTAMP(3),
    "checkFailureCount" INTEGER NOT NULL DEFAULT 0,
    "dataSource" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishedContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMetricSnapshot" (
    "id" TEXT NOT NULL,
    "publishedContentId" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "reposts" INTEGER,
    "favorites" INTEGER,
    "saves" INTEGER,
    "engagement" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "ContentMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMonitoringEvent" (
    "id" TEXT NOT NULL,
    "publishedContentId" TEXT NOT NULL,
    "type" "MonitoringEventType" NOT NULL,
    "fromStatus" "ContentStatus",
    "toStatus" "ContentStatus",
    "message" TEXT,
    "httpStatus" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentMonitoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignExpense" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignInfluencerId" TEXT,
    "type" "ExpenseType" NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KWD',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "incurredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "kind" TEXT,
    "influencerId" TEXT,
    "campaignId" TEXT,
    "deliverableId" TEXT,
    "scriptReferenceId" TEXT,
    "noteId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerTag" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "InfluencerTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "influencerId" TEXT,
    "brandId" TEXT,
    "authorId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "targetUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "userId" TEXT,
    "brandId" TEXT,
    "influencerId" TEXT,
    "campaignId" TEXT,
    "publishedContentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" TEXT,
    "brandId" TEXT,
    "campaignId" TEXT,
    "influencerId" TEXT,
    "deliverableId" TEXT,
    "publishedContentId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" JSONB,
    "config" JSONB,
    "lastTestAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_isActive_idx" ON "Brand"("isActive");

-- CreateIndex
CREATE INDEX "Influencer_relationshipStatus_idx" ON "Influencer"("relationshipStatus");

-- CreateIndex
CREATE INDEX "Influencer_primaryPlatform_idx" ON "Influencer"("primaryPlatform");

-- CreateIndex
CREATE INDEX "Influencer_country_idx" ON "Influencer"("country");

-- CreateIndex
CREATE INDEX "Influencer_category_idx" ON "Influencer"("category");

-- CreateIndex
CREATE INDEX "Influencer_isActive_idx" ON "Influencer"("isActive");

-- CreateIndex
CREATE INDEX "SocialAccount_influencerId_idx" ON "SocialAccount"("influencerId");

-- CreateIndex
CREATE INDEX "SocialAccount_platform_idx" ON "SocialAccount"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_username_key" ON "SocialAccount"("platform", "username");

-- CreateIndex
CREATE INDEX "SocialMetricSnapshot_socialAccountId_capturedAt_idx" ON "SocialMetricSnapshot"("socialAccountId", "capturedAt");

-- CreateIndex
CREATE INDEX "BrandInfluencer_brandId_idx" ON "BrandInfluencer"("brandId");

-- CreateIndex
CREATE INDEX "BrandInfluencer_influencerId_idx" ON "BrandInfluencer"("influencerId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandInfluencer_brandId_influencerId_key" ON "BrandInfluencer"("brandId", "influencerId");

-- CreateIndex
CREATE INDEX "Campaign_brandId_idx" ON "Campaign"("brandId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_startDate_idx" ON "Campaign"("startDate");

-- CreateIndex
CREATE INDEX "Campaign_endDate_idx" ON "Campaign"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_brandId_slug_key" ON "Campaign"("brandId", "slug");

-- CreateIndex
CREATE INDEX "CampaignInfluencer_campaignId_idx" ON "CampaignInfluencer"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignInfluencer_influencerId_idx" ON "CampaignInfluencer"("influencerId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignInfluencer_campaignId_influencerId_key" ON "CampaignInfluencer"("campaignId", "influencerId");

-- CreateIndex
CREATE INDEX "Deliverable_campaignInfluencerId_idx" ON "Deliverable"("campaignInfluencerId");

-- CreateIndex
CREATE INDEX "Deliverable_status_idx" ON "Deliverable"("status");

-- CreateIndex
CREATE INDEX "Deliverable_dueDate_idx" ON "Deliverable"("dueDate");

-- CreateIndex
CREATE INDEX "Deliverable_platform_idx" ON "Deliverable"("platform");

-- CreateIndex
CREATE INDEX "ScriptReference_campaignId_idx" ON "ScriptReference"("campaignId");

-- CreateIndex
CREATE INDEX "ScriptReferenceVersion_scriptReferenceId_idx" ON "ScriptReferenceVersion"("scriptReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptReferenceVersion_scriptReferenceId_version_key" ON "ScriptReferenceVersion"("scriptReferenceId", "version");

-- CreateIndex
CREATE INDEX "PublishedContent_campaignId_idx" ON "PublishedContent"("campaignId");

-- CreateIndex
CREATE INDEX "PublishedContent_brandId_idx" ON "PublishedContent"("brandId");

-- CreateIndex
CREATE INDEX "PublishedContent_influencerId_idx" ON "PublishedContent"("influencerId");

-- CreateIndex
CREATE INDEX "PublishedContent_availabilityStatus_idx" ON "PublishedContent"("availabilityStatus");

-- CreateIndex
CREATE INDEX "PublishedContent_publishedAt_idx" ON "PublishedContent"("publishedAt");

-- CreateIndex
CREATE INDEX "PublishedContent_detectedAt_idx" ON "PublishedContent"("detectedAt");

-- CreateIndex
CREATE INDEX "PublishedContent_nextCheckAt_idx" ON "PublishedContent"("nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedContent_platform_originalUrl_key" ON "PublishedContent"("platform", "originalUrl");

-- CreateIndex
CREATE INDEX "ContentMetricSnapshot_publishedContentId_capturedAt_idx" ON "ContentMetricSnapshot"("publishedContentId", "capturedAt");

-- CreateIndex
CREATE INDEX "ContentMonitoringEvent_publishedContentId_checkedAt_idx" ON "ContentMonitoringEvent"("publishedContentId", "checkedAt");

-- CreateIndex
CREATE INDEX "ContentMonitoringEvent_type_idx" ON "ContentMonitoringEvent"("type");

-- CreateIndex
CREATE INDEX "CampaignExpense_campaignId_idx" ON "CampaignExpense"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignExpense_campaignInfluencerId_idx" ON "CampaignExpense"("campaignInfluencerId");

-- CreateIndex
CREATE INDEX "Attachment_influencerId_idx" ON "Attachment"("influencerId");

-- CreateIndex
CREATE INDEX "Attachment_campaignId_idx" ON "Attachment"("campaignId");

-- CreateIndex
CREATE INDEX "Attachment_deliverableId_idx" ON "Attachment"("deliverableId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "InfluencerTag_tagId_idx" ON "InfluencerTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerTag_influencerId_tagId_key" ON "InfluencerTag"("influencerId", "tagId");

-- CreateIndex
CREATE INDEX "Note_influencerId_idx" ON "Note"("influencerId");

-- CreateIndex
CREATE INDEX "Note_brandId_idx" ON "Note"("brandId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_createdAt_idx" ON "Notification"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_category_idx" ON "Notification"("category");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_brandId_idx" ON "ActivityLog"("brandId");

-- CreateIndex
CREATE INDEX "ActivityLog_campaignId_idx" ON "ActivityLog"("campaignId");

-- CreateIndex
CREATE INDEX "ActivityLog_influencerId_idx" ON "ActivityLog"("influencerId");

-- CreateIndex
CREATE INDEX "ActivityLog_type_idx" ON "ActivityLog"("type");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSetting_platform_key" ON "IntegrationSetting"("platform");

-- CreateIndex
CREATE INDEX "SavedView_scope_idx" ON "SavedView"("scope");

-- CreateIndex
CREATE INDEX "SavedView_userId_idx" ON "SavedView"("userId");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMetricSnapshot" ADD CONSTRAINT "SocialMetricSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInfluencer" ADD CONSTRAINT "BrandInfluencer_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInfluencer" ADD CONSTRAINT "BrandInfluencer_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluencer" ADD CONSTRAINT "CampaignInfluencer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluencer" ADD CONSTRAINT "CampaignInfluencer_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_scriptReferenceId_fkey" FOREIGN KEY ("scriptReferenceId") REFERENCES "ScriptReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptReference" ADD CONSTRAINT "ScriptReference_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptReferenceVersion" ADD CONSTRAINT "ScriptReferenceVersion_scriptReferenceId_fkey" FOREIGN KEY ("scriptReferenceId") REFERENCES "ScriptReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptReferenceVersion" ADD CONSTRAINT "ScriptReferenceVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedContent" ADD CONSTRAINT "PublishedContent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedContent" ADD CONSTRAINT "PublishedContent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedContent" ADD CONSTRAINT "PublishedContent_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedContent" ADD CONSTRAINT "PublishedContent_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedContent" ADD CONSTRAINT "PublishedContent_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMetricSnapshot" ADD CONSTRAINT "ContentMetricSnapshot_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMonitoringEvent" ADD CONSTRAINT "ContentMonitoringEvent_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignExpense" ADD CONSTRAINT "CampaignExpense_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignExpense" ADD CONSTRAINT "CampaignExpense_campaignInfluencerId_fkey" FOREIGN KEY ("campaignInfluencerId") REFERENCES "CampaignInfluencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignExpense" ADD CONSTRAINT "CampaignExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_scriptReferenceId_fkey" FOREIGN KEY ("scriptReferenceId") REFERENCES "ScriptReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerTag" ADD CONSTRAINT "InfluencerTag_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerTag" ADD CONSTRAINT "InfluencerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_publishedContentId_fkey" FOREIGN KEY ("publishedContentId") REFERENCES "PublishedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
