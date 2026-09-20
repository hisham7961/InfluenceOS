# Workflow Gap Matrix

Companion to `ENTITY_RELATIONSHIP_AUDIT.md`. Same source-of-truth pass (HEAD `f9d2d79`). Every
CURRENT cell below was verified by reading actual code, not inferred.

## Influencer → Campaign
- **CURRENT**: Influencer page has a "Campaign History" tab (`profile-tabs.tsx:48,137-186`)
  showing rollup stats + brands worked with, but no per-campaign list/links.
- **EXPECTED**: see which campaigns this influencer is/was on, jump to each.
- **GAP**: no campaign-level list, only aggregate stats + brand chips.
- **EXISTING COMPONENT TO REUSE**: `CampaignInfluencer` rows are already queryable by
  `influencerId`; the Campaign list/card components used elsewhere (`apps/web/src/components`)
  can render this without a new data model.
- **IMPLEMENTATION**: add a small campaign list to the History tab (or a dedicated sub-section)
  querying campaign-influencer rows for this influencer. Low priority relative to the Content/
  Logistics gaps below — deferred past this pass unless time remains.

## Influencer → Content
- **CURRENT**: Content tab exists and correctly shows all `PublishedContent` for the influencer
  regardless of campaign (`profile-tabs.tsx:190-196`, `page.tsx:39` fetches
  `api.content.feed({influencerId})`) — **no duplicate datastore, this part is already right**.
  But there is **no "Add Content" action anywhere on the page** (confirmed by full grep).
- **EXPECTED**: `Add Content` button on the Influencer page, preselecting this influencer,
  campaign optional.
- **GAP**: missing entry point only — the read side is already correct.
- **EXISTING COMPONENT TO REUSE**: the (to-be-built) shared `AddContentFlow` (WF-5/WF-6), invoked
  with `defaultInfluencerId` context. Reuses `api.content.create` — no new route.
- **IMPLEMENTATION**: add an "Add Content" button to the Influencer page header or Content tab,
  opening `AddContentFlow` with `influencerId` prefilled and locked.

## Influencer → Notes
- **CURRENT**: `NotesPanel` tab already exists and works (`profile-tabs.tsx:224-226`).
- **EXPECTED**: same.
- **GAP**: none.
- **EXISTING COMPONENT TO REUSE**: n/a — already correct.
- **IMPLEMENTATION**: none needed.

## Influencer → Files
- **CURRENT**: `Attachment.influencerId` exists in the schema and is populated elsewhere (e.g.
  Deliverable attachments), but the Influencer page has no Files/Attachments tab
  (`profile-tabs.tsx` tab list: Overview/Social/History/Content/Costs/Notes/Brands — no Files).
- **EXPECTED**: a Files tab listing attachments scoped to this influencer.
- **GAP**: missing UI surface for data the schema already supports.
- **EXISTING COMPONENT TO REUSE**: whatever attachment-list component the Deliverable/Campaign
  Files tabs already use (found via the Campaign workspace's "Files" tab).
- **IMPLEMENTATION**: add a Files tab to `profile-tabs.tsx` querying `Attachment` by
  `influencerId`. Deferred past this pass (not part of the Content/Logistics core ask) unless
  time remains — flagged here so it isn't lost.

## Influencer → Logistics History
- **CURRENT**: does not exist — no shipment/logistics data is shown anywhere on the Influencer
  page.
- **EXPECTED**: influencer-level view of shipments sent to them across all campaigns, and an
  operational timeline (campaign joined → deliverable requested → shipment shipped/delivered →
  draft received → approved → content linked → paid) per the brief's "Influencer Operational
  Timeline" requirement.
- **GAP**: full gap — no UI, and today's `ProductShipment` (1:1 per CampaignInfluencer) makes a
  cross-campaign influencer shipment list non-trivial to query cleanly without a join through
  CampaignInfluencer.
- **EXISTING COMPONENT TO REUSE**: `ActivityLog` already carries `influencerId` +
  `campaignId` + `deliverableId` + `publishedContentId` + a typed `type` enum — **this is the
  timeline source**, per the brief's own instruction not to build a duplicate history table.
- **IMPLEMENTATION**: WF-13 — add a Timeline section to the Influencer page that queries
  `ActivityLog` by `influencerId`, ordered by `createdAt`. No new table. Logistics-specific rows
  (shipment shipped/delivered) require `logActivity()` calls to be added at those transition
  points in the evolved shipment service (currently `shipment.service.ts` never calls
  `logActivity`/`createNotification` at all — confirmed by reading the file — this is itself a
  gap independent of the schema evolution).

## Campaign → Influencer
- **CURRENT**: Campaign workspace has an "Influencers" tab (roster), fully functional
  (add/remove/update participation).
- **EXPECTED**: same.
- **GAP**: none found.

## Campaign → Deliverable
- **CURRENT**: "Deliverables" tab, `AddDeliverableDialog` (`workspace.tsx:783-896`), functional.
- **EXPECTED**: same.
- **GAP**: none in the association itself. (The gap is Deliverable→Content and Deliverable→
  Logistics, covered separately below.)

## Campaign → Content
- **CURRENT**: "Live Content" tab, **read-only** — fetches `api.content.feed({campaignId})` and
  renders `ContentGrid` (`workspace.tsx:180-185`). No "Add Content" action anywhere in the tab or
  page (confirmed by grep for Add Published/AddContent/Add content).
- **EXPECTED**: an "Add Content" action from the Campaign Workspace, preselecting the campaign,
  letting the user pick an influencer (from the roster) and optionally a deliverable.
- **GAP**: missing entry point; the read side (feed filtered by `campaignId`) is already correct
  and is exactly "a filtered view, not a copy" as the brief requires — no change needed there.
- **EXISTING COMPONENT TO REUSE**: same shared `AddContentFlow`, invoked with `defaultCampaignId`
  and an influencer selector scoped to `campaignInfluencers` of this campaign (so the selector
  can't offer someone not on the roster — this is the safe version of SCENARIO E's "reject
  before save" requirement, enforced by construction in this context rather than after the fact).
- **IMPLEMENTATION**: add an "Add Content" button to the Live Content tab.

## Campaign → Logistics
- **CURRENT**: "Shipments" tab exists, **explicitly read-only** (its own doc comment says so) —
  table view only, no create/edit/status UI in the browser despite the backend
  (`shipment.service.ts`) already supporting `upsert`/`updateStatus`. This is the clearest
  "backend feature that existed but was not exposed correctly" found in this audit.
- **EXPECTED**: full CRUD from the Campaign, two-way status visibility once a logistics employee
  updates something from `/logistics` (WF-13).
- **GAP**: UI-only right now (no schema/route change needed to make the *existing* single-
  shipment-per-creator flow editable) — but the multi-shipment requirement (SCENARIO J) requires
  the schema evolution in WF-12 first.
- **EXISTING COMPONENT TO REUSE**: `shipment.service.ts::upsert/updateStatus` (already correct
  API), just needs a form wired to it.
- **IMPLEMENTATION**: WF-12/WF-13 — evolve the model, then build the editing UI once, reused by
  both the Campaign tab and the new `/logistics` page.

## Campaign → Cost
- **CURRENT**: "Costs" tab, `AddCost` Quick Add form, both functional, both calling
  `api.campaigns.addExpense`.
- **EXPECTED**: same.
- **GAP**: none found.

## Deliverable → Submission
- **CURRENT (corrected during implementation)**: `submission.service.ts` fully implements
  create/review/comment, and the domain logic is correct — `review()`'s APPROVE path never
  creates `PublishedContent` (verified: no `prisma.publishedContent.create` call exists in
  `submission.service.ts`; the file's own comment states "a UGC deliverable reaches this without
  ever having a public social URL"). **But the initial pass of this audit under-stated the gap**:
  `packages/api-client/src/index.ts` had **zero** methods for submission create/review/comment
  (only a read-only `campaigns.submissions(id)` list), and the Campaign "Submissions" tab
  (`submissions-tab.tsx`) was a **read-only table with no way to submit a draft or act on a
  review** — a textbook "backend feature that existed but was not exposed correctly."
- **EXPECTED**: UGC must be able to complete (submit → review → approve) without a public URL,
  operable end-to-end in the browser, not just possible in principle at the API layer.
- **GAP → FIXED**: added `api.deliverables.submit`/`api.deliverables.submissions` and
  `api.submissions.{get,review,addComment}` to the API client; added a "Submit draft" action on
  UGC `DeliverableRow`s (asset link optional, notes optional — no URL required) and a
  `SubmissionReviewDialog` in the Submissions tab (approve/request changes/reject + threaded
  comments), wired to the existing, already-correct domain service. No new backend logic was
  needed — this was purely a "connect the existing service to a client" fix, exactly the kind the
  brief's "existing but disconnected" category describes.

## Deliverable → PublishedContent
- **CURRENT**: `content.service.ts::create` accepts `deliverableId` and derives
  `campaignInfluencerId`/`campaignId`/`influencerId` from it **only when those fields are not
  already supplied** (`??` fill-only, `content.service.ts:98-118`) — no conflict detection. There
  is **no UI entry point** for "Add Published Content" from a Deliverable at all (confirmed:
  `DeliverableRow` in `workspace.tsx:645-752` only has a status select, a "View published" link
  if `publishedUrl` is already set, and delete — no create action).
- **EXPECTED** (Critical Business Question 5 / Scenario C): from a Deliverable, one click derives
  Influencer + Campaign + CampaignInfluencer + Brand automatically, user only pastes the URL, no
  repeated selectors, and an inconsistent combination (Scenario F: deliverable belongs to Ahmed,
  caller also passes Sara as influencerId) must be **rejected**, not silently overwritten.
- **GAP**: two gaps — (1) no UI entry point, (2) the derivation that exists has no conflict
  validation, so Scenario F does not fail today, it silently succeeds with mismatched data.
- **EXISTING COMPONENT TO REUSE**: shared `AddContentFlow`, invoked with `deliverableId` locked
  (all other association fields hidden/derived, matching the brief's "deliverable fixed, nothing
  else asked" requirement) — plus the new centralized association resolver (WF-5) called from
  `content.service.ts::create` instead of the current inline fill-only logic.
- **IMPLEMENTATION**: WF-5 (resolver with conflict rejection) + WF-6 (wire it into create/update)
  + WF-9 (the UI entry point on `DeliverableRow`).

## Deliverable → Logistics
- **CURRENT**: does not exist in any form. `Deliverable` has no `physicalProductRequired` field,
  no product/quantity fields; `deliverable.service.ts` never imports or references the shipment
  domain; `ProductShipment` has no `deliverableId` FK to link back even if a UI existed.
- **EXPECTED** (brief's core Logistics requirement): creating/editing a Deliverable with
  "Physical product required" = true lets the user pick products+quantities+address, which
  creates/links a Logistics Request transactionally; one CampaignInfluencer may have *multiple*
  such requests (one per deliverable that needs one).
- **GAP**: full gap — this is genuinely new schema + domain + UI, not a wiring fix. Sized and
  planned under WF-12.
- **EXISTING COMPONENT TO REUSE**: `ProductShipment` model/service/UI pattern is the right base
  to **evolve** (per the brief's explicit instruction to reuse rather than build a parallel
  system) — see WF-12 for the exact migration plan (drop the 1:1 unique constraint, add an
  optional `deliverableId`, add a `ShipmentItem`/product-line-items child table, add a minimal
  `Product` catalog scoped per Brand).
- **IMPLEMENTATION**: WF-12.

## PublishedContent → Influencer / Campaign / Deliverable (reassignment / reconciliation)
- **CURRENT**: `content.service.ts::update` allows independently changing `campaignId`,
  `influencerId`, `deliverableId` on an existing row with **zero validation** (no existence
  check beyond the Prisma FK constraint, which would surface as an uncaught error, not a clean
  `AppError`) and **zero recomputation**: `brandId` is never refreshed when `campaignId`
  changes, and `campaignInfluencerId` isn't even in the update schema — it is left stale forever
  once set. There is also no UI for this at all today (no "assign influencer"/"change campaign"
  affordance on any content view).
- **EXPECTED** (Scenario G / the brief's "Association Resolution" + "Re-linking must recompute
  derived associations" sections): authorized users can assign/change/remove influencer,
  campaign, and deliverable on existing content, with every derived field reconciled atomically
  and no stale IDs left behind.
- **GAP**: both the domain logic and the UI are missing/broken.
- **EXISTING COMPONENT TO REUSE**: the same centralized association resolver from WF-5, called
  from `update()` the same way `create()` should be, wrapped in the transaction pattern
  `content.service.ts::create` already uses for its multi-step writes (`$transaction`, DB-07
  pattern already established in this codebase — reuse it, don't invent a new transaction style).
- **IMPLEMENTATION**: WF-6 (fix `update()`) + WF-10 (the reassignment UI on the new Content
  Detail page).

## Logistics → Campaign / Influencer / Deliverable
- **CURRENT**: does not exist — no cross-linking, no `/logistics` page, no deliverable link.
- **EXPECTED**: two-way status visible from all three without manual copying.
- **GAP**: full gap, depends entirely on WF-12's schema evolution landing first.
- **IMPLEMENTATION**: WF-13.

---

## Additional dead-end found outside the requested list: Quick Add → Content Detail
- **CURRENT**: Quick Add's `AddContent` form (`quick-add.tsx:79-83`) only exposes URL + optional
  campaign (no influencer selector, no deliverable selector, no "I don't know the influencer
  yet" state), and on success calls `router.push('/content/${content.id}')` — **a route that
  does not exist anywhere in `apps/web/src/app`** (verified: no `content/[id]` directory). The
  same dead link is produced by global search results
  (`search.service.ts:117,252`) and by the notification `targetUrl` set in
  `content.service.ts:190,393`. This is a confirmed, verified dead end exactly matching the
  brief's warning not to assume the route exists.
- **EXPECTED**: a real Content Detail page.
- **GAP**: full gap — page does not exist at all (not a stub, a 404).
- **EXISTING COMPONENT TO REUSE**: `GET /content/:id` (`content.service.ts::detail`) already
  returns a complete `PublishedContentDTO` with embed descriptor, metrics, monitoring history —
  the backend is ready, only the page is missing.
- **IMPLEMENTATION**: WF-6/WF-10 — build `apps/web/src/app/(app)/content/[id]/page.tsx`.

## Global Live Content filters
- **CURRENT**: Brand / Platform / Status / free-text search only
  (`content-wall.tsx:172-277`). No Campaign filter, no Influencer filter, no Assigned/Unassigned
  filter — though individual cards already render "Unassigned" incidentally when
  `content.influencer` is null.
- **EXPECTED**: brief requires Brand/Campaign/Influencer/Platform/Status/Assignment-status
  filters, matching the same filter set already available server-side
  (`contentFilterSchema` supports `campaignId`/`influencerId` — the API already accepts these,
  the web UI just doesn't expose them).
- **GAP**: UI-only — the backend filter contract already supports what's missing.
- **IMPLEMENTATION**: WF-10 — add Campaign/Influencer selects and an Assigned/Partially
  Linked/Unassigned filter to `FilterBar`, computed client-side from the existing
  influencer/campaign/deliverable nullability (no new backend enum needed, matching the brief's
  "derived UI state, not necessarily a database enum" instruction).
