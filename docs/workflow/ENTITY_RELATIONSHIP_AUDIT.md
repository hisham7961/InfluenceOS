# Entity Relationship Audit

Produced by a full read of `packages/database/prisma/schema.prisma` (1212 lines) and every
relevant domain service, on branch `claude/new-session-2rsnjm`, HEAD `f9d2d79`. This reflects
what the system **actually does today**, not aspiration.

Legend: `?` = nullable FK. `!` = required FK. `1:1` = unique FK (one row per parent).

---

## Brand
- **CREATE FROM**: standalone (root/tenant entity).
- **CAN EXIST WITHOUT**: everything — it has no FK fields itself.
- **OPTIONAL LINKS**: none (it is the parent side of every relation below it).
- **REQUIRED LINKS**: none.
- **DERIVED LINKS**: none.
- **EDITABLE LINKS**: n/a.
- **HISTORICAL LINKS**: none.
- Children: `Campaign[]`, `BrandInfluencer[]`, `PublishedContent[]`, `Note[]`, `Notification[]`,
  `ActivityLog[]`, `UsageRight[]`, `UserBrandAccess[]`.

## Influencer
- **CREATE FROM**: standalone (`POST /influencers`, or Quick Add "Add influencer" — same call).
- **CAN EXIST WITHOUT**: Brand, Campaign, Deliverable, Content — an influencer can exist with
  zero campaigns and zero published content.
- **OPTIONAL LINKS**: `ownerId?` (User).
- **REQUIRED LINKS**: none.
- **DERIVED LINKS**: none stored on the row itself.
- **EDITABLE LINKS**: `ownerId` (reassign).
- **HISTORICAL LINKS**: `BrandInfluencer.totalCollaborations/firstCollaborationAt/lastCampaignAt`
  are a recomputed rollup (`campaign-influencer.service.ts::syncRelationship`, counts only
  CONFIRMED/IN_PROGRESS/COMPLETED participations — DB-10 safeguard), not raw history.
- Children: `SocialAccount[]`, `BrandInfluencer[]`, `CampaignInfluencer[]`, `CampaignCandidate[]`,
  `CreatorOAuthToken[]`, `PublishedContent[]`, `InfluencerTag[]`, `Note[]`, `Attachment[]`,
  `ActivityLog[]`, `Notification[]`, `UsageRight[]`.

## BrandInfluencer (Brand ↔ Influencer relationship metadata)
- **CREATE FROM**: auto-upserted the first time an influencer joins any campaign for that brand
  (`campaign-influencer.service.ts::add`) — never created directly by a user action today.
- **CAN EXIST WITHOUT**: Campaign (it is *about* the brand+influencer pair, not any one campaign).
- **OPTIONAL LINKS**: none beyond its own two required FKs.
- **REQUIRED LINKS**: `brandId!`, `influencerId!` — `@@unique([brandId, influencerId])`.
- **DERIVED LINKS**: `totalCollaborations`, `firstCollaborationAt`, `lastCampaignAt` — recomputed
  from CampaignInfluencer rows, not independently editable.
- **EDITABLE LINKS**: `relationshipStatus`, `priority`, `defaultRate`, `currency` — relationship
  terms, not the brand/influencer pair itself (immutable once created, matching the unique key).
- **HISTORICAL LINKS**: none — it is a live rollup, not a snapshot log.
- **Note**: this model does **not** link onward into CampaignInfluencer/Deliverable — it is
  purely brand+influencer relationship metadata, disconnected from the roster chain below.

## Campaign
- **CREATE FROM**: standalone within a Brand (`POST /campaigns`, requires `brandId`).
- **CAN EXIST WITHOUT**: any Influencer, Deliverable, or Content — a brand-new campaign has none
  of these until influencers are added to its roster.
- **OPTIONAL LINKS**: `ownerId?` (User).
- **REQUIRED LINKS**: `brandId!` — immutable after creation (not in `campaignUpdateSchema`'s
  writable set).
- **DERIVED LINKS**: none stored.
- **EDITABLE LINKS**: `ownerId`.
- **HISTORICAL LINKS**: none.
- Children: `CampaignInfluencer[]`, `CampaignCandidate[]`, `ScriptReference[]`,
  `PublishedContent[]`, `CampaignExpense[]`, `ActivityLog[]`, `Notification[]`, `Attachment[]`,
  `UsageRight[]`.

## CampaignCandidate (pre-roster sourcing pipeline)
- **CREATE FROM**: `Campaign` + `Influencer` pair, before roster commitment
  (`sourcing.service.ts::add`).
- **CAN EXIST WITHOUT**: CampaignInfluencer — this is explicitly the *pre*-roster stage.
- **OPTIONAL LINKS**: `addedById?`, `decidedById?` (User).
- **REQUIRED LINKS**: `campaignId!`, `influencerId!` — `@@unique([campaignId, influencerId])`.
- **DERIVED LINKS**: none.
- **EDITABLE LINKS**: `status` (CONSIDERING/SHORTLISTED/APPROVED/REJECTED/CONVERTED), `fitScore`,
  `notes`, `decisionReason`.
- **HISTORICAL LINKS**: `convertedCampaignInfluencerId` — **not a real Prisma relation** (plain
  string column, no `@relation`, no FK constraint, not traversable via the Prisma relation API).
  This is a soft/historical pointer only, and it is not referentially enforced — a genuine
  structural gap if the pointed-to CampaignInfluencer is ever deleted (dangling string, no
  cascade, no error).
- **CONVERT**: `sourcing.service.ts::convert` creates the CampaignInfluencer using the
  candidate's *own* `campaignId`/`influencerId` (never caller-supplied), so this path has no
  conflict-injection surface.

## CampaignInfluencer (the roster — join between Campaign and Influencer)
- **CREATE FROM**: `Campaign` + `Influencer`, explicitly (`campaign-influencer.service.ts::add`)
  or via `CampaignCandidate.convert`.
- **CAN EXIST WITHOUT**: Deliverable, Content, Shipment — a roster row can exist with none of
  these yet.
- **OPTIONAL LINKS**: none beyond its own two required FKs.
- **REQUIRED LINKS**: `campaignId!`, `influencerId!` — `@@unique([campaignId, influencerId])`,
  both existence-validated on create, **immutable after creation** (`campaignInfluencerUpdateSchema`
  omits both — cannot be reassigned via update).
- **DERIVED LINKS**: triggers `BrandInfluencer` upsert + `syncRelationship()` recompute on
  add/update(participationStatus)/remove.
- **EDITABLE LINKS**: `dealType`, `agreedCost`, `participationStatus`, `paymentStatus`, etc. —
  never the campaignId/influencerId pair itself.
- **HISTORICAL LINKS**: none directly; it *is* the source of truth `BrandInfluencer` rolls up
  from.
- Children: `Deliverable[]`, `PublishedContent[]`, `CampaignExpense[]`, **`ProductShipment?` (1:1,
  see below — structural limitation)**.

## Deliverable
- **CREATE FROM**: a `CampaignInfluencer` (`deliverable.service.ts::create`, `campaignInfluencerId`
  is required, existence-validated).
- **CAN EXIST WITHOUT**: DeliverableSubmission, PublishedContent — a deliverable can sit in
  `PLANNED` with neither.
- **OPTIONAL LINKS**: `scriptReferenceId?`.
- **REQUIRED LINKS**: `campaignInfluencerId!` — **immutable after creation**
  (`deliverableUpdateSchema` omits it entirely — no gap here, this is correctly locked down).
- **DERIVED LINKS**: none stored (campaign/influencer/brand are reached by traversing
  `campaignInfluencer`, never denormalized onto Deliverable itself).
- **EDITABLE LINKS**: `status`, `publishedUrl`, `publishedAt`, `requirements`, etc.
- **HISTORICAL LINKS**: none.
- **Gap (structural, pre-existing)**: no `physicalProductRequired` flag, no product/quantity
  fields, and `DeliverableType` has no shipment-flavored value — `deliverable.service.ts` never
  imports or touches the shipment domain at all. A "this deliverable needs a product shipped"
  concept does not exist anywhere in the data model today (see Logistics section, WORKFLOW_GAP_MATRIX
  item D→Logistics).
- Children: `PublishedContent[]`, `Attachment[]`, `ActivityLog[]`, `DeliverableSubmission[]`.

## DeliverableSubmission (draft/asset review — NOT public content)
- **CREATE FROM**: a `Deliverable` (`submission.service.ts::create`).
- **CAN EXIST WITHOUT**: PublishedContent — **confirmed, and this is correctly built already**:
  `review()`'s APPROVE path (`DECISION_MAP`) advances `Deliverable.status` to `APPROVED` and
  stamps `publishedAt` if unset, but never calls into `content.service.ts` and never creates a
  `PublishedContent` row. `DeliverableSubmissionDTO` has no `publishedContentId` field. A UGC
  deliverable can fully complete (submitted → reviewed → approved) with zero public URL. This is
  the one area of the brief's concern that is **already correct** — no fix needed, only UI
  verification that no screen forces a URL on this path (see WORKFLOW_GAP_MATRIX).
- **OPTIONAL LINKS**: `submittedById?`, `reviewedById?` (User).
- **REQUIRED LINKS**: `deliverableId!` — `@@unique([deliverableId, version])`, immutable.
- **DERIVED LINKS**: none.
- **EDITABLE LINKS**: `status`, `assetUrl`, `reviewNote`.
- **HISTORICAL LINKS**: each `version` is its own row — the version history *is* the historical
  record (no separate log needed). Child `SubmissionComment[]` (flat list, not threaded despite
  the model's doc comment).

## PublishedContent (the actual public social URL — or an unassigned detected URL)
- **CREATE FROM**: standalone, or from any context that supplies zero or more of
  brandId/campaignId/influencerId/campaignInfluencerId/deliverableId
  (`content.service.ts::create`).
- **CAN EXIST WITHOUT**: **all of Brand, Campaign, Influencer, CampaignInfluencer, and
  Deliverable simultaneously** — every one of these five FKs is nullable on the Prisma model.
  This is the single most important fact in this audit: the schema *already* supports
  Influencer-only content, Campaign+Influencer content, and fully-unassigned content. The gap in
  this codebase is not in the data model — it is that (a) nothing validates the *combination* of
  supplied IDs is consistent, and (b) no UI surface lets a user exercise the influencer-only or
  unassigned paths on create, or repair an unassigned row later. See WORKFLOW_GAP_MATRIX.
- **OPTIONAL LINKS**: `brandId?`, `campaignId?`, `influencerId?`, `campaignInfluencerId?`,
  `deliverableId?` — all five independently nullable, no CHECK constraint tying them together.
- **REQUIRED LINKS**: none association-wise. `platform` and `originalUrl` are required (identity
  fields, not associations); `@@unique([platform, originalUrl])` is the dedup key.
- **DERIVED LINKS (today, partial)**: `content.service.ts::create` line 98-118 fills
  `campaignInfluencerId`/`campaignId`/`influencerId` from `deliverableId` **only when those
  fields are null** (`??` fill-only), and fills `brandId` from `campaignId` the same way.
  **Gap**: no conflict check — if a caller supplies both `deliverableId` (belonging to
  Campaign A / Influencer A) and an explicit `campaignId`/`influencerId` pointing elsewhere, the
  mismatched caller-supplied values silently win and the row is created inconsistent. This is
  the exact defect SCENARIO F in the brief is designed to catch, and today it is **not caught**.
- **EDITABLE LINKS**: `campaignId`, `influencerId`, `deliverableId` are all independently
  settable via `content.service.ts::update` — but **with zero validation and zero
  recomputation**: `brandId` is never refreshed when `campaignId` changes (update() has no
  equivalent of create()'s brandId-derivation), and `campaignInfluencerId` is never
  recomputed/invalidated when campaignId/influencerId change (it isn't even in the update
  schema, so it silently goes stale). This is the exact defect behind SCENARIO G (reassign
  unassigned content must reconcile all derived associations, no stale IDs) — today it does not.
- **HISTORICAL LINKS**: `ContentMetricSnapshot[]` (point-in-time metrics, correctly modeled as an
  immutable append-only child, not overwritten fields) and `ContentMonitoringEvent[]`
  (availability-check history). Also referenced (nullable FK) from `Notification`, `ActivityLog`,
  `UsageRight`.

## UsageRight
- **CREATE FROM**: a Brand (required); optionally scoped to Campaign/Influencer/Content.
- **CAN EXIST WITHOUT**: Campaign, Influencer, PublishedContent (all three nullable,
  `onDelete: SetNull` — a right can outlive the content/campaign it was granted for, which is
  correct: usage rights are a legal/brand-level record, not derived from content presence).
- **OPTIONAL LINKS**: `campaignId?`, `influencerId?`, `publishedContentId?`, `createdById?`.
- **REQUIRED LINKS**: `brandId!`.
- **DERIVED LINKS**: `effectiveStatus` (computed from `status`+`expiresAt`, not stored).
- **EDITABLE LINKS**: none of the FKs are updatable post-creation in current routes (scope
  fields like `territory`/`exclusive` are).
- **HISTORICAL LINKS**: none — a right that expires/gets revoked changes `status` in place
  rather than being superseded by a new row; acceptable for this domain (legal terms, not an
  event log).

## Attachment
- **CREATE FROM**: any one of Influencer/Campaign/Deliverable/ScriptReference/Note (polymorphic
  by independently-nullable FK — same pattern as PublishedContent).
- **CAN EXIST WITHOUT**: all five parents simultaneously is theoretically representable by the
  schema (all nullable) but not a real product concept — attachments are always uploaded *from*
  one of these contexts today; no "unassigned attachment inbox" is needed or requested.
- **OPTIONAL LINKS**: `influencerId?`, `campaignId?`, `deliverableId?`, `scriptReferenceId?`,
  `noteId?`, `uploadedById?`.
- **REQUIRED LINKS**: none FK-wise; `storageKey` unique.
- **DERIVED LINKS**: none.
- **EDITABLE LINKS**: not reassignable between parents in current routes (create-time only).
- **HISTORICAL LINKS**: none.

## CampaignExpense
- **CREATE FROM**: a Campaign; optionally attributed to one CampaignInfluencer.
- **CAN EXIST WITHOUT**: CampaignInfluencer (nullable — a campaign-level cost like ads spend
  isn't tied to one creator).
- **OPTIONAL LINKS**: `campaignInfluencerId?`, `createdById?`.
- **REQUIRED LINKS**: `campaignId!`.
- **DERIVED LINKS**: none stored (campaign spend rollups are computed on read).
- **EDITABLE LINKS**: `paymentStatus`, `paidAmount`, `paidAt`.
- **HISTORICAL LINKS**: none — a correction is an update-in-place, not a new row (acceptable;
  this is a ledger line, not a status transition needing an audit trail beyond ActivityLog).

## ActivityLog
- **CREATE FROM**: any domain action, via `logActivity()` helper — write-only from the system's
  perspective (not user-editable).
- **CAN EXIST WITHOUT**: any of its five nullable association FKs individually, but always has
  `actorId?` + `type` + `message`.
- **OPTIONAL LINKS**: `actorId?`, `brandId?`, `campaignId?`, `influencerId?`, `deliverableId?`,
  `publishedContentId?` — all independently nullable (correct: a login event has none of these;
  a content-status-change event has campaign+influencer+content).
- **REQUIRED LINKS**: `type`, `message`.
- **DERIVED LINKS**: n/a — it *is* the derived/historical record other features should read from.
- **EDITABLE LINKS**: none — append-only by design.
- **HISTORICAL LINKS**: this model **is** the historical link for everything else. Per the brief's
  own instruction ("do not create duplicate history tables if ActivityLog can provide the
  source"), any Influencer/Campaign operational timeline should be built by querying this table
  filtered by influencerId/campaignId, not a new table. Today nothing queries it for that
  purpose on the Influencer or Campaign pages — see WORKFLOW_GAP_MATRIX (Influencer→Logistics
  History, and the operational timeline requirement).

## Notification
- **CREATE FROM**: any domain action, via `createNotification()` helper.
- **CAN EXIST WITHOUT**: brandId/influencerId/campaignId/publishedContentId individually
  (all nullable, same polymorphic pattern).
- **OPTIONAL LINKS**: `userId?`, `brandId?`, `influencerId?`, `campaignId?`, `publishedContentId?`.
- **REQUIRED LINKS**: `category`, `title`.
- **DERIVED LINKS**: none.
- **EDITABLE LINKS**: `isRead`/`readAt` only.
- **HISTORICAL LINKS**: `NotificationDelivery[]` (per-channel delivery record, correctly a child
  row rather than overwritten fields).

## ProductShipment (today's only shipment/logistics model — see Logistics section below)
- **CREATE FROM**: a `CampaignInfluencer`, directly — **never from a Deliverable** (no
  `deliverableId` field exists on this model at all; `deliverable.service.ts` never imports or
  references the shipment domain).
- **CAN EXIST WITHOUT**: nothing — it always belongs to exactly one CampaignInfluencer.
- **OPTIONAL LINKS**: `createdById?`.
- **REQUIRED LINKS**: **`campaignInfluencerId! @unique`** — this is the structural limitation the
  brief calls out. It is a true `1:1`, not `1:many`. `shipment.service.ts` only exposes
  `upsert(campaignInfluencerId, …)` (Prisma `upsert` keyed on that unique column) and
  `updateStatus(campaignInfluencerId, …)` — there is no way, today, to create a second shipment
  for the same CampaignInfluencer. A "replacement shipment" or "shipment for video 2" scenario
  for the same creator+campaign is **not representable** by the current schema — SCENARIO J in
  the brief would fail outright today.
- **DERIVED LINKS**: none.
- **EDITABLE LINKS**: `status` (free transition, no state-machine guard — any enum value is
  accepted directly by `updateStatus`), `courier`, `trackingNumber`, address/recipient fields.
  Auto-stamps `shippedAt`/`deliveredAt` on first reaching SHIPPED/IN_TRANSIT/DELIVERED
  (`autoTimestamps()`), unless the caller explicitly supplied them.
- **HISTORICAL LINKS**: none — updating status **overwrites the same row** (no snapshot of what
  the address/recipient *was* at ship time). The brief explicitly requires shipments to store a
  historical snapshot of the influencer's shipping info at time of shipment, independent of
  later changes to the influencer's current address — today there is no
  "influencer shipping profile" model at all to snapshot *from*, so this requirement needs new
  schema (see WORKFLOW_GAP_MATRIX, Logistics section).
- **Product/SKU/quantity**: **not present as structured fields** — contents are captured only
  via a free-text `notes` field. No `Product` catalog model exists anywhere in the schema
  (confirmed by exhaustive case-insensitive grep — every "product" hit is either an enum value
  like `GIFT_PRODUCT`/`GIFTED_PRODUCT` or this model itself).
- **UI**: the only UI surface for this model (`ShipmentsTab` in the Campaign workspace) is
  explicitly read-only (its own doc comment says so) — no create/edit/status-change UI exists in
  the browser today despite the backend supporting `upsert`/`updateStatus`. This is a clean
  example of "backend features that already existed but were not exposed correctly."
- **Migration history**: introduced whole in one migration
  (`20260918150929_product_shipment_tracking`), never altered since.

---

## Cross-cutting findings that shape the reuse plan (WF-4)

1. **The schema is already association-friendly.** `PublishedContent` (and `Attachment`,
   `ActivityLog`, `Notification`) already use independently-nullable FKs, not a rigid required
   chain. The brief's "CRITICAL BUSINESS QUESTIONS" 1 and 2 (content without campaign, content
   without known influencer) are **already representable today** with zero schema change. The
   real gap is entirely in (a) validation/derivation logic and (b) UI surfaces, not the data model.
2. **No centralized association resolver exists.** The one piece of derivation logic that does
   exist (`content.service.ts::create` lines 98-118) is incomplete (fill-only, no conflict
   detection) and is not reused by `update()` at all, nor by any other service. This is exactly
   the "duplicated concept" the brief warns against forming — not duplicated *yet*, but about to
   be if each new entry point (Quick Add fix, Influencer→Content, Campaign→Content,
   Deliverable→Content) reimplements its own derivation instead of calling one shared function.
3. **Quick Add is not a duplicate backend.** Every Quick Add form calls the exact same
   `api.content.create` / `api.influencers.create` / `api.campaigns.create` routes the full
   pages use — confirmed by reading `quick-add.tsx` in full. The "NO DUPLICATE FORMS POLICY" is
   already honored at the API layer. The actual defect is narrower than the brief assumed: the
   Quick Add **content** form's UI is simply missing fields (no influencer selector, no
   deliverable selector) that the backend already accepts.
4. **UGC-without-publication already works correctly** (`DeliverableSubmission` review/approve
   never touches `PublishedContent`). No backend change needed there — only a UI audit to confirm
   no screen implies a URL is required to finish a UGC deliverable.
5. **The Logistics gap is real and is the largest structural item**: 1:1 shipment constraint,
   no deliverable link, no product line items, no shipping-snapshot model, read-only UI, no
   cross-campaign `/logistics` page. This is the one area genuinely requiring new schema
   (a migration), not just new derivation/validation logic on top of the existing shape.
6. **`/content/:id` is a confirmed dead route** — both the Quick Add success redirect and the
   global-search result links point at a page that does not exist in `apps/web/src/app`. This is
   the concrete, verified instance of the brief's "test it in the browser, don't assume" warning.
