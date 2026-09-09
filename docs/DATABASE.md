# Database

Source of truth: [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma)
(PostgreSQL via Prisma Client 6.3.1). This document is the annotated reference the schema's
header comment points to — read the schema for exact field types; this page explains the
shape and the rules behind it.

## Conventions

- **IDs.** Every model uses `id String @id @default(cuid())` — no auto-increment integers,
  no client-supplied IDs. cuids are collision-resistant, sortable-ish, and safe to generate
  on any tier (API, worker, or a future mobile client) without a round trip to the database.
- **Timestamps.** Almost every model carries `createdAt DateTime @default(now())`; models
  that are mutated after creation add `updatedAt DateTime @updatedAt` (Prisma sets it on
  every update automatically). Append-only "event" rows (snapshots, monitoring events,
  activity log, notifications) only have `createdAt`/`capturedAt`/`checkedAt` — there is
  nothing to update because they are never edited.
- **Money.** Monetary fields (`defaultRate`, `plannedBudget`, `agreedCost`,
  `giftedProductValue`, `CampaignExpense.amount`) are `Decimal @db.Decimal(14, 2)`, paired
  with a sibling `currency String` column (campaign/expense default `"KWD"`) — never
  floats.
- **Indexing.** Foreign keys used in lookups are indexed (`@@index([...])`), status/enum
  columns that back list-screen filters are indexed (`status`, `relationshipStatus`,
  `availabilityStatus`, `isActive`, …), and natural uniqueness is enforced with
  `@@unique` (e.g. `[platform, username]` on `SocialAccount`, `[brandId, slug]` on
  `Campaign`) instead of relying on application code. Time-series tables index the
  `(parentId, capturedAt/checkedAt)` pair so "latest snapshot for X" and range queries
  are index-backed.
- **Cascades.** `onDelete: Cascade` is used for true ownership (deleting an `Influencer`
  removes its `SocialAccount`s, `InfluencerTag`s, etc.; deleting a `Campaign` removes its
  `CampaignInfluencer`s, `ScriptReference`s, `CampaignExpense`s). Cross-cutting references
  that should survive their neighbor's deletion (e.g. `Notification.brand`,
  `ActivityLog.campaign`) are left as plain optional relations without cascade.
- **JSON is a last resort.** Structured JSON columns (`rawMetadata`, `embedConfig`,
  `capabilities`, `config`, `meta`, `filters`, `extra`) exist only for raw provider
  payloads, provider capability descriptors, or genuinely free-form/admin-defined data.
  Every value the product reasons about, filters on, or displays as a first-class field is
  a real normalized column — not a JSON blob.

## Design rules honored throughout

1. **Snapshots are additive — history is never overwritten.** `SocialMetricSnapshot` and
   `ContentMetricSnapshot` are pure inserts: each sync/poll writes a new row with its own
   `capturedAt`; nothing is updated in place, so growth/trend charts and historical
   accuracy are preserved. `ContentMonitoringEvent` is the same pattern for availability
   checks.
2. **`NULL` over fabricated zeros.** Metric fields (`followers`, `views`, `likes`,
   `engagementRate`, …) are all optional (`Int?`/`Float?`). When a platform's API/embed
   can't supply a number, the column is left `NULL` and rendered as "N/A" — it is never
   defaulted to `0`, which would misrepresent real zero-engagement content as
   unmeasured (or vice versa). This is why nearly every metric-bearing model also carries
   a `DataSource` (`MANUAL` / `OFFICIAL_API` / `EMBED` / `UNAVAILABLE`) so the UI can show
   *why* a value is missing or how trustworthy it is.
3. **JSON only for raw provider metadata / capabilities.** See "JSON is a last resort"
   above — enforced consistently: `SocialAccount.rawMetadata`, `PublishedContent.rawMetadata`
   and `embedConfig`, `IntegrationSetting.capabilities`/`config` are the only places
   provider-shaped, schema-less data is allowed to live.

---

## Core entities

| Model | Purpose | Key fields / relations |
|---|---|---|
| **User** | Internal staff/admin account (no self-serve signup). | `email` (unique), `passwordHash` (Argon2id), `role` (`ADMIN`/`STAFF`), `locale`, `theme`. Owns campaigns (`CampaignOwner`), activities, notes, script versions, attachments, expenses, notifications, saved views, device sessions. |
| **Brand** | A client brand InfluenceOS runs campaigns for. | `slug` (unique), logo/icon/cover URLs, brand colors (`primaryColor`, `accentColor`, `secondaryColor`), `isActive`. Root of campaigns, brand-influencer relationships, published content, notes, notifications, activity. |
| **Influencer** | Global influencer/creator profile — one record shared across all brands. | Identity (`displayName`, `fullName`, `country`, `city`, `category`, `languages[]`), contact (`email`, `mobile`, `whatsapp`, `managerContact`, `preferredContact`), CRM state (`relationshipStatus`, `priority`, `audienceHealth`), `pricingNotes`/`internalNotes`. Has social accounts, brand relationships, campaign participations, published content, tags, notes, attachments. |
| **SocialAccount** | One platform handle belonging to an influencer. | `platform` + `username` (unique pair), `followers`/`following`/`postCount` (nullable), `isVerified`, `isPrimary`, `dataSource`, `lastSyncedAt`, `rawMetadata` (Json, raw provider payload). Has many `SocialMetricSnapshot`s. |
| **SocialMetricSnapshot** | Point-in-time follower/growth snapshot for a `SocialAccount`. | `followers`, `following`, `postCount`, `engagementRate` (all nullable), `capturedAt`, `source`. Additive — never updates a prior snapshot. Indexed `[socialAccountId, capturedAt]`. |
| **BrandInfluencer** | Per-brand relationship layer over the global `Influencer` (rates, status, and history differ brand-to-brand without duplicating the influencer). | Unique `[brandId, influencerId]`. `relationshipStatus`, `priority`, `defaultRate`/`currency`, `firstCollaborationAt`, `lastCampaignAt`, `totalCollaborations`. |
| **Campaign** | A brand's influencer marketing campaign. | Unique `[brandId, slug]`. `status`, `objective`, `startDate`/`endDate`, `currency` (default `KWD`), `plannedBudget`, `ownerId` → `User`. Has campaign influencers, scripts, published content, expenses, activity, notifications. |
| **CampaignInfluencer** | One influencer's participation in one campaign — the hub that deliverables, published content, and expenses attach to. | Unique `[campaignId, influencerId]`. `dealType`, `agreedCost`/`currency`, `giftedProductValue`, `participationStatus`, `paymentStatus`, `expectedPublishAt`. |
| **Deliverable** | A concrete content commitment owed by an influencer within a campaign participation (e.g. "2 Reels by March 1"). | `platform`, `type`, `quantity`, `dueDate`, `requiredHashtags[]`/`requiredMentions[]`, optional `scriptReferenceId`, `status`, `publishedUrl`/`publishedAt`. Links to `PublishedContent` and `Attachment`s once fulfilled. |
| **ScriptReference** (+ **ScriptReferenceVersion**) | Versioned creative brief/script attached to a campaign, referenced by deliverables. | `ScriptReference`: `title`, `currentVersion` pointer, optional `campaignId`. `ScriptReferenceVersion`: immutable numbered snapshot (`[scriptReferenceId, version]` unique) with `body`, `captionSuggestion`, `talkingPoints[]`, `dos[]`/`donts[]`, `requiredClaims[]`, `hashtags[]`/`mentions[]`, `referenceLinks[]`, `createdById`. Editing a script creates a new version rather than mutating the old one. |
| **PublishedContent** | A live piece of content discovered/pasted from a platform, optionally tied back to campaign/influencer/deliverable. | Unique `[platform, originalUrl]`. `externalId`, `embedUrl`/`embedConfig` (Json, typed embed descriptor), `availabilityStatus`, `lastCheckedAt`/`nextCheckAt` (monitoring schedule), `checkFailureCount`, `dataSource`, `rawMetadata`. Has metric snapshots, monitoring events, notifications, activity. |
| **ContentMetricSnapshot** | Point-in-time performance snapshot (views/likes/comments/etc.) for a `PublishedContent`. | All metric fields nullable (`views`, `likes`, `comments`, `shares`, `reposts`, `favorites`, `saves`, `engagement`, `engagementRate`); `NULL` = "not available for this platform", never a fabricated `0`. `capturedAt`, `source`. Additive, indexed `[publishedContentId, capturedAt]`. |
| **ContentMonitoringEvent** | Audit trail of an availability check performed on a `PublishedContent`. | `type` (`CHECK_OK`/`STATUS_CHANGED`/`CHECK_FAILED`/`RATE_LIMITED`), `fromStatus`/`toStatus`, `httpStatus`, `success`, `checkedAt`. Additive log, indexed `[publishedContentId, checkedAt]`. |
| **CampaignExpense** | A cost line item on a campaign (optionally scoped to one influencer's participation). | `type` (`ExpenseType`), `amount`/`currency`, `paymentStatus`, `incurredAt`, `createdById`. |
| **Attachment** | An uploaded file (creative asset, contract, reference image, …) polymorphically attached to one of `Influencer`/`Deliverable`/`ScriptReference`/`Note` (plus a loose `campaignId`). | `fileName`, `mimeType`, `sizeBytes`, `storageKey`, `url`, `kind`, `uploadedById`. |
| **Tag** / **InfluencerTag** | Free-form labels for influencers (many-to-many via join table). | `Tag.name` unique; `InfluencerTag` unique `[influencerId, tagId]`. |
| **Note** | A freeform internal note on an influencer and/or brand. | `body`, `pinned`, optional `influencerId`/`brandId`/`authorId`; can carry `Attachment`s. |
| **Notification** | An in-app alert surfaced to a user (or broadcast) about something needing attention. | `category` (`NotificationCategory`), `title`/`body`/`targetUrl`, `isRead`/`readAt`, optional links to `user`/`brand`/`influencer`/`campaign`/`publishedContent`. Has many `NotificationDelivery` rows. |
| **ActivityLog** | Append-only feed of "what happened" across the system, for timelines and audit. | `type` (`ActivityType`), `message`, `actorId` → `User`, optional links to `brand`/`campaign`/`influencer`/`deliverable`/`publishedContent`, `meta` (Json, event-specific extra detail). Indexed by `createdAt`, `brandId`, `campaignId`, `influencerId`, `type`. |
| **IntegrationSetting** | One row per social `Platform` describing that provider's connection/config state, for the Admin Integrations screen. | `platform` unique, `status` (`IntegrationStatus`), `isEnabled`, `monitoringEnabled`, `capabilities`/`config` (Json, provider-specific), `lastTestAt`/`lastSuccessAt`/`lastError`. |
| **SavedView** | A user's (or shared) saved filter set for a directory/feed screen. | `scope`, `name`, `filters` (Json — arbitrary filter payload), `isShared`, optional `userId`. |

## Mobile / API-readiness additions

These models exist ahead of a mobile client so the API contract and auth model don't need
to change later (see `docs/MOBILE_READINESS.md` for the fuller addendum context; schema
comments cite the relevant addendum section numbers §16–§22).

| Model | Purpose | Key fields / relations |
|---|---|---|
| **DeviceSession** | One row per authenticated client session (web cookie session today, a future native device tomorrow) — holds the hashed refresh token so tokens can rotate and sessions can be revoked server-side. | `client` (`ClientType`: `WEB`/`IOS`/`ANDROID`/`API`), `deviceId`/`deviceName`/`appVersion`/`userAgent`/`ip`, `refreshTokenHash`, `pushToken`, `lastActiveAt`, `expiresAt`, `revokedAt`. |
| **NotificationDelivery** | Independent per-channel delivery record for a `Notification`, so delivery logic doesn't need reworking when `PUSH`/`EMAIL` ship for mobile — today only `IN_APP` deliveries are produced. | `channel` (`NotificationChannel`), `status` (`NotificationDeliveryStatus`), `target`, `error`, `deliveredAt`. |
| **FeatureFlag** | Central feature flag, resolvable per platform/client/brand. | Unique `[key, scope, brandId]`. `scope` (`FeatureFlagScope`: `PLATFORM`/`WEB`/`MOBILE`/`BRAND`), `enabled`, optional `brandId`. |
| **ClientConfig** | Singleton server-owned config surfaced to clients via `GET /api/v1/client-config`; never contains secrets. | `maintenanceMode`/`maintenanceMessage`, `defaultLanguage`, `supportedLanguages[]` (default `["en","ar"]`), `maxUploadMb`, `supportInfo`, `extra` (Json). |
| **AppVersion** | Per-mobile-platform version/update rules the (not-yet-built) mobile app will read. | `platform` unique (`MobilePlatform`: `IOS`/`ANDROID`), `recommendedVersion`/`minimumVersion`, `storeUrl`, `forceUpdate`, `maintenanceMessage`. |

## Enums

| Enum | Values | Used by |
|---|---|---|
| `UserRole` | `ADMIN`, `STAFF` | `User.role` |
| `Platform` | `INSTAGRAM`, `TIKTOK`, `YOUTUBE`, `SNAPCHAT`, `X` | `SocialAccount`, `Deliverable`, `PublishedContent`, `IntegrationSetting`, `AppVersion` (indirectly via `MobilePlatform`) |
| `DataSource` | `MANUAL`, `OFFICIAL_API`, `EMBED`, `UNAVAILABLE` | Provenance of externally-sourced values — `SocialAccount`, `SocialMetricSnapshot`, `PublishedContent`, `ContentMetricSnapshot` |
| `RelationshipStatus` | `PROSPECT`, `CONTACTED`, `NEGOTIATING`, `ACTIVE`, `RECURRING`, `PAST`, `DECLINED`, `BLACKLISTED` | `Influencer`, `BrandInfluencer` |
| `Priority` | `LOW`, `MEDIUM`, `HIGH` | `Influencer`, `BrandInfluencer` |
| `ContactMethod` | `WHATSAPP`, `EMAIL`, `PHONE`, `INSTAGRAM_DM`, `OTHER` | `Influencer.preferredContact` |
| `AudienceHealthLabel` | `HEALTHY`, `REVIEW`, `LIMITED_DATA` | `Influencer.audienceHealth` |
| `CampaignStatus` | `DRAFT`, `PLANNING`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED` | `Campaign.status` |
| `CampaignObjective` | `AWARENESS`, `ENGAGEMENT`, `CONVERSIONS`, `LAUNCH`, `UGC`, `OTHER` | `Campaign.objective` |
| `DealType` | `FREE`, `PAID`, `GIFTED_PRODUCT`, `PAID_PLUS_GIFTED` | `CampaignInfluencer.dealType` — `FREE` covers unpaid/organic collaborations with no cost line implied |
| `ParticipationStatus` | `INVITED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `DECLINED`, `DROPPED` | `CampaignInfluencer.participationStatus` |
| `DeliverableType` | `POST`, `STORY`, `REEL`, `SHORT`, `VIDEO`, `LIVE`, `TWEET`, `SNAP`, `CAROUSEL`, `OTHER` | `Deliverable.type` |
| `DeliverableStatus` | `PLANNED`, `SENT_TO_INFLUENCER`, `AWAITING_PUBLICATION`, `PUBLISHED`, `VERIFIED`, `MISSED`, `CANCELLED` | `Deliverable.status` |
| `ContentStatus` | `LIVE`, `REMOVED`, `PRIVATE`, `UNAVAILABLE`, `BROKEN_LINK`, `UNKNOWN` | `PublishedContent.availabilityStatus`, `ContentMonitoringEvent.fromStatus`/`toStatus` |
| `PaymentStatus` | `NOT_APPLICABLE`, `UNPAID`, `PARTIALLY_PAID`, `PAID` | `CampaignInfluencer.paymentStatus`, `CampaignExpense.paymentStatus` |
| `ExpenseType` | `INFLUENCER_FEE`, `GIFT_PRODUCT`, `PRODUCTION`, `ADS`, `SHIPPING`, `OTHER` | `CampaignExpense.type` |
| `NotificationCategory` | `CONTENT_REMOVED`, `CONTENT_UNAVAILABLE`, `DELIVERABLE_OVERDUE`, `DELIVERABLE_DUE_SOON`, `CAMPAIGN_ENDING`, `SYNC_FAILURE`, `NEW_CONTENT`, `FOLLOWER_MILESTONE`, `GENERAL` | `Notification.category` |
| `ActivityType` | `BRAND_CREATED`/`UPDATED`, `INFLUENCER_ADDED`/`UPDATED`, `SOCIAL_ACCOUNT_ADDED`, `INFLUENCER_ADDED_TO_CAMPAIGN`, `CAMPAIGN_CREATED`/`STATUS_CHANGED`/`UPDATED`, `DELIVERABLE_ADDED`/`STATUS_CHANGED`, `SCRIPT_ADDED`/`UPDATED`, `CONTENT_PUBLISHED`/`STATUS_CHANGED`, `COST_ADDED`/`UPDATED`, `NOTE_ADDED`, `FOLLOWER_MILESTONE`, `GENERIC` | `ActivityLog.type` |
| `MonitoringEventType` | `CHECK_OK`, `STATUS_CHANGED`, `CHECK_FAILED`, `RATE_LIMITED` | `ContentMonitoringEvent.type` |
| `IntegrationStatus` | `ENABLED`, `DISABLED`, `NOT_CONFIGURED`, `ERROR` | `IntegrationSetting.status` |
| `ClientType` | `WEB`, `IOS`, `ANDROID`, `API` | `DeviceSession.client` |
| `NotificationChannel` | `IN_APP`, `PUSH`, `EMAIL` | `NotificationDelivery.channel` |
| `NotificationDeliveryStatus` | `PENDING`, `SENT`, `FAILED`, `SKIPPED` | `NotificationDelivery.status` |
| `FeatureFlagScope` | `PLATFORM`, `WEB`, `MOBILE`, `BRAND` | `FeatureFlag.scope` |
| `MobilePlatform` | `IOS`, `ANDROID` | `AppVersion.platform` |

---

## Migrations & seed

All commands run from the repo root (`pnpm --filter @influenceos/database <script>` under
the hood) and read `DATABASE_URL`/`DIRECT_DATABASE_URL` from the root `.env`:

| Command | What it does |
|---|---|
| `pnpm db:generate` | Regenerates the Prisma Client after a schema change. |
| `pnpm db:migrate` | `prisma migrate dev` — creates/applies a dev migration from schema changes. |
| `pnpm db:deploy` | `prisma migrate deploy` — applies pending migrations in a deployed environment (no schema diffing/prompts). |
| `pnpm db:seed` | Runs `packages/database/prisma/seed.ts` (`tsx`) to populate baseline/demo data. |
| `pnpm db:reset` | `prisma migrate reset --force` — drops, re-migrates, and re-seeds the database. **Destructive.** |
| `pnpm db:studio` | Opens Prisma Studio against the configured database for manual inspection/editing. |

Package-local equivalents (run from `packages/database/`) are `generate`, `migrate:dev`,
`migrate:deploy`, `migrate:reset`, `seed`, and `studio` — see
[`packages/database/package.json`](../packages/database/package.json).
