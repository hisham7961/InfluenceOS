# Final Surface Matrix — Backend ↔ API Client ↔ Web UI

Exhaustive cross-reference of every exported domain-service function (`packages/domain/src/services/*.ts`) against its HTTP route (`apps/api/src/routes/*.ts`), its `api-client` wrapper (`packages/api-client/src/index.ts`), and its caller(s) in the web app (`apps/web/src`). Purpose: catch anything the prior "sampled, not exhaustive" audits (`A_TO_Z_TECHNICAL_AUDIT.md`, `SETTINGS_REALITY_MATRIX.md`, etc.) might have missed by walking the *entire* surface mechanically rather than by sample.

Method: every service factory's `return { ... }` statement was read in full (the authoritative list of a service's public functions, not just its exported symbols); every route file was read in full; every top-level key of `createClient()` in `api-client` was read in full; web usage was checked both with a literal `api.ns.method(` grep and a whitespace/newline-tolerant chained-call check (`api.ns\n.method(`) to avoid false negatives from multi-line call chains. `apps/worker/src` and `apps/api/src/app.ts`/`http.ts` were checked as legitimate non-HTTP/non-UI callers before anything was flagged as dead.

No secrets, credentials, or credential values appear in this document.

## Summary

- **Services**: 38 (all of `packages/domain/src/services/*.ts`)
- **Service functions enumerated**: 202 (counted from each service's actual `return { ... }` object, which is its real public surface — not raw `export function` grep, which over/under-counts helpers and type-only exports)
- **HTTP routes registered**: 186 (across 28 route files, all registered in `apps/api/src/routes/index.ts`)
- **`api-client` methods defined**: 169 (top-level keys under `createClient()` in `packages/api-client/src/index.ts`)
- **Rows in this matrix**: 202 (one per service function)

### Classification counts

| Classification | Count | Meaning |
|---|---:|---|
| **OK** | 154 | Full chain present and either directly wired to a UI caller, or reachable through a legitimate internal path (helper called by a routed sibling function, worker job, request-auth middleware, or a documented redirect/webhook route that a client library correctly has no method for) |
| **NO-CLIENT** | 18 | Route exists, `api-client` has **no** wrapper method for it |
| **DEAD-CLIENT-METHOD** | 14 | Route **and** client method both exist, but the client method has zero web callers **and** the exact same data is already fully available to the UI through another endpoint it actually calls (redundant/superseded — safe-to-remove candidates) |
| **NO-UI-internal** | 5 | Route and client method exist, no web caller, but there's a documented, plausible reason (mobile-first-not-yet-built, deliberate soft-delete design, etc.) |
| **NO-UI-gap** | 9 | Route and client method (or route alone, for the sourcing/candidate group counted under NO-CLIENT) exist, no web caller, and **no** plausible reason — an operator would reasonably want this and it appears to have simply never been wired into the UI |
| **NO-ROUTE** | 2 | Exported service function with no HTTP route, no worker caller, and no internal caller anywhere in the codebase — genuine dead code |
| **DEAD-ROUTE** | 0 | No routes were found that are registered but never call any service function, or that are otherwise unreachable — all 186 routes are live and registered |

Note: `shipment.service.ts`'s `listForDeliverable` was NO-ROUTE at audit time; a concurrent Final Completion Pass work-stream (gap #9, Deliverable→Shipment nav) added its route/client method/UI caller shortly after this table was drafted, and the row below was corrected post-hoc to OK — the counts above already reflect that correction (154 OK / 2 NO-ROUTE), not a full audit re-run.

Note: several `NO-CLIENT` rows (the entire single-candidate CRUD lifecycle: get/add/update/decide/convert/remove) represent one coherent feature gap — the Sourcing pipeline is read-only + bulk-CSV-import only in the web app even though the backend fully supports adding, editing, deciding on, converting, and removing individual candidates. See "Most concerning findings" below.

---

## activity.service.ts — `activity`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| feed | GET /activity | `activity.feed` | `apps/web/src/app/(app)/activity` (activity feed page) | OK | |

## analytics.service.ts — `analytics`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| creatorLeaderboard | GET /reports/leaderboard | `reports.leaderboard` | reports/leaderboard page | OK | |
| executiveDashboard | GET /reports/exec-dashboard | `reports.execDashboard` | reports/exec-dashboard page | OK | |
| campaignEfficiency | GET /campaigns/:idOrSlug/efficiency | `campaigns.efficiency` | campaign workspace | OK | |

## attachment.service.ts — `attachments`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| initiate | POST /files | `files.initiate` | `apps/web/src/lib/upload.ts` (`uploadAttachment`) | OK | |
| writeBlob | PUT /files/blob | *(none)* | `apps/web/src/lib/upload.ts` `putBytes()` via raw `XMLHttpRequest` | NO-CLIENT | Deliberate: binary PUT needs `xhr.upload.onprogress` for upload-progress reporting, which a JSON-typed client wrapper can't give cleanly. Route is fully used, just not through `api-client`. Not a gap. |
| complete | POST /files/complete | `files.complete` | `apps/web/src/lib/upload.ts` | OK | |
| list | GET /files | `files.list` | `apps/web/src/components/common/attachments-panel.tsx` | OK | |
| get | GET /files/:id | `files.get` | `apps/web/src/components/collaboration/comment-thread.tsx` | OK | |
| readBlobSigned | GET /files/:id/blob | *(none)* | `apps/web/src/lib/upload.ts` `toBrowserUrl()` builds the URL used directly in `<img src>`/`<a href>` | NO-CLIENT | Same reasoning as writeBlob — a signed download link is meant to be used as a raw URL, not fetched through the typed client. Not a gap. |
| remove | DELETE /files/:id | `files.remove` | `attachments-panel.tsx` | OK | |
| cleanupAbandonedUploads | *(none)* | *(none)* | `apps/worker/src/processors.ts` → `apps/worker/src/index.ts` hourly maintenance sweep | OK | Worker-only cron job by design; never meant to be HTTP-routed. |
| maxUploadBytes | *(none)* | *(none)* | internal utility — used inside `attachment.service.ts` itself, `platform.service.ts` (status reporting), and `apps/api/src/app.ts` (global Fastify `bodyLimit`) | OK | Plain helper function, not a service action. |

## auth.service.ts — `auth`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| login | POST /auth/login | `auth.login` | login page | OK | |
| refresh | POST /auth/refresh | `auth.refresh` | *(client method itself has no web caller)* — `apps/web/src/middleware.ts` calls the route directly via raw `fetch()` | OK | Edge-runtime middleware can't use the Node-oriented api-client, so it `fetch()`s the route directly for silent token refresh. Route is fully exercised; the typed wrapper is simply unused. |
| logout | POST /auth/logout | `auth.logout` | user menu | OK | |
| authenticate | *(none)* | *(none)* | `apps/api/src/http.ts` `resolveActor()` — called on **every** authenticated request | OK | Core request-auth path, correctly never a route of its own. |
| me | GET /auth/me | `auth.me` | session bootstrap | OK | |
| updatePreferences | PATCH /auth/me/preferences | `auth.updatePreferences` | settings | OK | |
| sessions | GET /auth/sessions | `auth.sessions` | settings/security | OK | |
| revokeSession | DELETE /auth/sessions/:id | `auth.revokeSession` | settings/security | OK | |
| changePassword | POST /auth/change-password | `auth.changePassword` | settings/security | OK | |
| listUsers | GET /users | `users.list` | settings/users | OK | |
| listDirectory | GET /users/directory | `users.directory` | @mention picker | OK | |
| createUser | POST /users | `users.create` | settings/users | OK | |
| updateUser | PATCH /users/:id | `users.update` | settings/users (edit sheet) | OK | |
| resetUserPassword | POST /users/:id/reset-password | `users.resetPassword` | *(none found)* | **NO-UI-gap** | Real gap. There is no self-service "forgot password" flow anywhere in the app (only an authenticated change-password), and no "Reset password" action in the admin user-edit sheet (`apps/web/src/app/(app)/settings/users/user-edit-sheet.tsx`) either. This is the **only** password-recovery path in the whole system and it has zero UI. |
| removeUser | DELETE /users/:id | `users.remove` | *(none found)* | NO-UI-internal | The user-edit sheet only exposes an `isActive` toggle (soft deactivate via `users.update`); hard delete appears to be a deliberate design choice (keeps audit-log/activity referential integrity). Plausible and consistent with the rest of the app's soft-delete patterns. |
| getUserBrandAccess | GET /users/:id/brand-access | `users.getBrandAccess` | *(none found)* | DEAD-CLIENT-METHOD | Data is already embedded in `GET /users/:id/permissions` (`UserAdminDetailDTO`), which the edit sheet fetches once via `api.users.getPermissions()`. This dedicated getter is redundant. |
| setUserBrandAccess | PUT /users/:id/brand-access | `users.setBrandAccess` | user-edit-sheet.tsx | OK | |
| getUserCountryAccess | GET /users/:id/country-access | `users.getCountryAccess` | *(none found)* | DEAD-CLIENT-METHOD | Same as `getUserBrandAccess` — redundant with `getPermissions()`. |
| setUserCountryAccess | PUT /users/:id/country-access | `users.setCountryAccess` | user-edit-sheet.tsx | OK | |
| setUserCapabilityOverrides | PUT /users/:id/capabilities | `users.setCapabilities` | user-edit-sheet.tsx | OK | |
| getUserPermissions | GET /users/:id/permissions | `users.getPermissions` | user-edit-sheet.tsx | OK | |
| previewUserPermissions | POST /users/:id/permissions/preview | `users.previewPermissions` | user-edit-sheet.tsx | OK | |
| hashPassword | *(none)* | *(none)* | internal — used by `createUser`/`resetUserPassword`/`changePassword` inside `auth.service.ts` itself | OK | Plain helper, exported on the return object but never meant to be its own route. |

## brand-influencer.service.ts — `brandInfluencers`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| upsert | POST /brand-influencers | `brandInfluencers.upsert` | *(none found)* | **NO-UI-gap** | The influencer profile page (`apps/web/src/app/(app)/influencers/[id]/profile-tabs.tsx`) displays `brandRelationships` read-only. There is no "link to brand" / "edit relationship" UI anywhere, despite a full create-or-update endpoint (status, priority, rate, notes) existing end to end. |
| listForInfluencer | GET /influencers/:id/brands | `influencers.brandRelationships` | profile-tabs.tsx | OK | |
| get | *(none)* | *(none)* | *(none anywhere — not even internal)* | **NO-ROUTE** | Genuinely dead: defined, returned from the service factory, but nothing in `apps/api`, `apps/worker`, or `packages/domain` itself calls it. Safe-to-remove candidate. |
| remove | DELETE /brand-influencers/:id | `brandInfluencers.remove` | *(none found)* | **NO-UI-gap** | Same story as `upsert` — no "unlink brand" action in the UI. |

## brand.service.ts — `brands`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /brands | `brands.list` | brand switcher, settings | OK | |
| detail | GET /brands/:idOrSlug | `brands.get` | *(none found)* | DEAD-CLIENT-METHOD | The brand workspace page fetches `api.brands.dashboard(slug)` instead, whose `BrandDashboardDTO` already embeds the full brand detail (`dashboard.brand()` calls `brandSvc.detail()` internally). `brands.get` is fully redundant for web. |
| create | POST /brands | `brands.create` | settings/brands | OK | |
| update | PATCH /brands/:id | `brands.update` | brand-edit-dialog.tsx | OK | |
| findByIdOrSlug | *(none)* | *(none)* | internal — used by `detail()`/`update()` within `brand.service.ts` | OK | |

## bulk-influencer.service.ts — `bulkInfluencers`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| preview | POST /influencers/bulk/preview | `influencers.bulkPreview` | `bulk-action-bar.tsx` | OK | |
| execute | POST /influencers/bulk/execute | `influencers.bulkExecute` | `bulk-action-bar.tsx` | OK | |

## bulk.service.ts — `bulk`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| addInfluencers | POST /campaigns/:id/influencers/bulk | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | "Add many influencers to a campaign roster at once (W3-4)" — fully built server-side, has no client wrapper at all, and no UI. Influencers can currently only be added to a campaign roster one at a time from the web app. |
| applyDeliverableTemplate | POST /campaigns/:id/deliverable-template | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | "Apply a deliverable template across the campaign roster (W3-4)" — same situation; server-built, unreachable from web. |
| importCandidatesCsv | POST /campaigns/:id/candidates/import | `campaigns.importCandidates` | `import-candidates-dialog.tsx` | OK | |

## calendar.service.ts — `calendar`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| events | GET /calendar | `calendar.events` | calendar page | OK | |

## campaign-influencer.service.ts — `campaignInfluencers`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| listForCampaign | GET /campaigns/:id/influencers | `campaigns.influencers` | campaign workspace | OK | |
| get | GET /campaign-influencers/:id | `campaignInfluencers.get` | *(none found)* | DEAD-CLIENT-METHOD | Campaign workspace opens each roster row from the already-fetched `campaigns.influencers(id)` list rather than re-fetching a single one. |
| add | POST /campaigns/:id/influencers | `campaigns.addInfluencer` | add-influencer-dialog.tsx | OK | |
| update | PATCH /campaign-influencers/:id | `campaignInfluencers.update` | campaign workspace | OK | |
| remove | DELETE /campaign-influencers/:id | `campaignInfluencers.remove` | campaign workspace | OK | |

## campaign-operations.service.ts — `campaignOperations`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| board | GET /campaigns/:id/operations-board | `campaigns.operationsBoard` | operations-board-tab.tsx | OK | |

## campaign.service.ts — `campaigns`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /campaigns | `campaigns.list` | campaigns page | OK | |
| listCursor | GET /campaigns/cursor | `campaigns.listCursor` | *(none found)* | NO-UI-internal | Explicitly commented "stable cursor pagination … W7-2 / mobile-ready feeds." Web deliberately uses the offset-paginated `campaigns.list` instead; this exists ahead of a cursor-based mobile client. |
| detail | GET /campaigns/:idOrSlug | `campaigns.get` | campaign workspace | OK | |
| create | POST /campaigns | `campaigns.create` | new-campaign-form.tsx | OK | |
| update | PATCH /campaigns/:id | `campaigns.update` | campaign workspace | OK | |
| findByIdOrSlug | *(none)* | *(none)* | internal — used by `detail()`/`create()`/`update()` in `campaign.service.ts` | OK | |
| brandSummarySelect | *(none)* | *(none)* | internal Prisma `select` constant, reused across the same file | OK | Not a function call — a shared query fragment. |

## content.service.ts — `content`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| create | POST /content | `content.create` | content-viewer / add-content dialog | OK | |
| feed | GET /content/feed | `content.feed` | content feed page, brand workspace | OK | |
| detail | GET /content/:id | `content.get` | content-viewer.tsx | OK | |
| update | PATCH /content/:id | `content.update` | content-viewer.tsx | OK | |
| metricsHistory | GET /content/:id/metrics | `content.metrics` | *(none found)* | **NO-UI-gap** | Real gap. There is no metric-history view anywhere in the content viewer despite the endpoint + client method existing end to end. |
| monitoring | GET /content/:id/monitoring | `content.monitoring` | content-viewer.tsx | OK | |
| addManualMetrics | POST /content/:id/metrics | `content.addMetrics` | *(none found)* | **NO-UI-gap** | Real gap. Route summary is literally "Add manual metrics (platforms without an official API)" — this is a documented, needed capability (many platforms have no public metrics API) with zero UI to use it. |
| refresh | POST /content/:id/refresh | `content.refresh` | content-viewer.tsx | OK | |
| mapRow | *(none)* | *(none)* | internal DTO-mapping helper, used throughout `content.service.ts` and by `dashboard.service.ts` | OK | |
| relIncludeFor | *(none)* | *(none)* | internal Prisma-include helper, same callers as `mapRow` | OK | |
| updateViewState | PATCH /content/:id/view-state | `content.updateViewState` | content-viewer.tsx / content cards | OK | |
| summary | GET /content/summary | `content.summary` | content feed page, dashboard (via `dashboard.global`) | OK | |

## creator-oauth.service.ts — `creatorOAuth`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| start | POST /influencers/:id/creator-connections/:platform/start | `influencers.startCreatorConnection` | social-accounts-panel.tsx | OK | |
| callback | GET /integrations/:platform/oauth/callback | *(none)* | browser navigates here directly (platform OAuth redirect) | OK | Public-by-design redirect endpoint; route's own comment says so. No client method needed or wanted. |
| status | GET /influencers/:id/creator-connections | `influencers.creatorConnections` | social-accounts-panel.tsx | OK | |
| disconnect | DELETE /influencers/:id/creator-connections/:platform | `influencers.disconnectCreator` | social-accounts-panel.tsx | OK | |
| accessToken | *(none)* | *(none)* | *(none anywhere)* | **NO-ROUTE** | Genuinely dead. The function's own doc comment says "server-only; for the metric fetchers," but neither `content.service.ts`'s `refresh()` nor `social-account.service.ts`'s `sync()` — nor the worker — actually call it. Built ahead of the feature that would use it; currently unreferenced. |

## creator360.service.ts — `creator360`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| snapshot | GET /influencers/:id/snapshot | `influencers.snapshot` | influencer profile | OK | |
| reliability | GET /influencers/:id/reliability | `influencers.reliability` | influencer profile | OK | |
| timeline | GET /influencers/:id/timeline | `influencers.timeline` | influencer profile | OK | |

## credential.service.ts — `credentials`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| statuses | GET /integrations/credentials | `integrations.credentials` | settings/integrations | OK | |
| set | POST /integrations/credentials | `integrations.setCredential` | settings/integrations | OK | |
| remove | DELETE /integrations/credentials/:key | `integrations.removeCredential` | settings/integrations | OK | |

## dashboard.service.ts — `dashboard`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| global | GET /dashboard/global | `dashboard.global` | home dashboard | OK | |
| brand | GET /brands/:idOrSlug/dashboard | `brands.dashboard` | brand workspace | OK | |
| pulse | *(none — embedded in `global()`)* | *(none)* | `mission-control.tsx` reads `data.pulse` from the `global()` response | OK | Composed into `GlobalDashboardDTO`, not its own route. |
| whatsNew | GET /whats-new | `dashboard.whatsNew` | *(none found)* | DEAD-CLIENT-METHOD | `mission-control.tsx` reads `data.whatsNewSummary` (embedded in `dashboard.global()`) instead of calling this raw-items endpoint directly. |
| whatsNewSummary | *(none — embedded in `global()`)* | *(none)* | `mission-control.tsx` reads `data.whatsNewSummary` | OK | |
| whatsNewAck | POST /dashboard/whats-new/ack | `dashboard.whatsNewAck` | mission-control.tsx | OK | |
| attention | GET /dashboard/attention | `dashboard.attention` | dashboard "needs attention" panel | OK | |

## data-quality.service.ts — `dataQuality`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| report | GET /data-quality/report | `dataQuality.report` | data-quality-workspace.tsx | OK | |
| duplicates | GET /data-quality/duplicates | `dataQuality.duplicates` | data-quality-workspace.tsx | OK | |

## deliverable.service.ts — `deliverables`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| create | POST /campaign-influencers/:id/deliverables | `campaignInfluencers.addDeliverable` | campaign workspace | OK | |
| update | PATCH /deliverables/:id | `deliverables.update` | campaign workspace | OK | |
| remove | DELETE /deliverables/:id | `deliverables.remove` | campaign workspace | OK | |

## expense.service.ts — `expenses`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| listForCampaign | GET /campaigns/:id/costs | `campaigns.costs` | campaign workspace (costs tab) | OK | |
| create | POST /campaigns/:id/expenses | `campaigns.addExpense` | campaign workspace | OK | |
| update | PATCH /expenses/:id | `expenses.update` | campaign workspace | OK | |
| remove | DELETE /expenses/:id | `expenses.remove` | campaign workspace | OK | |

## influencer.service.ts — `influencers`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /influencers | `influencers.list` | directory-results.tsx | OK | |
| listCursor | GET /influencers/cursor | `influencers.listCursor` | *(none found)* | NO-UI-internal | Same W7-2/mobile-ready-feeds pattern as `campaigns.listCursor`. |
| countrySummary | GET /influencers/country-summary | `influencers.countrySummary` | directory country strip | OK | |
| exportRows | GET /influencers/export | `influencers.exportRows` | *(none found — web uses `exportUrl` instead)* | NO-UI-internal | Client comment: "for programmatic / mobile use." Web builds a direct download `<a href>` via `exportUrl()` instead of fetching JSON through this method. |
| detail | GET /influencers/:id | `influencers.get` | influencer profile | OK | |
| create | POST /influencers | `influencers.create` | new-influencer flow | OK | |
| update | PATCH /influencers/:id | `influencers.update` | influencer profile edit | OK | |
| socialAccountsFor | GET /influencers/:id/social-accounts | `influencers.socialAccounts` | social-accounts-panel.tsx | OK | |
| audienceFor | GET /influencers/:id/audience-health | *(none)* | *(none — embedded in `influencers.get()`)* | NO-CLIENT | `detail()` calls `audienceFor()` internally and embeds the result as `audience` on `InfluencerDetailDTO`; `profile-tabs.tsx` reads `influencer.audience.*` directly. Standalone route is fully redundant but harmless. |
| followerSeries | GET /influencers/:id/followers | *(none)* | `follower-chart.tsx` calls `api.http.get(...)` directly with the raw path | NO-CLIENT | Real client-library gap: the route **is** used by the UI, but through the low-level `http.get()` escape hatch rather than a named, typed method — an inconsistency in `api-client`, worth adding `influencers.followers()` for type safety, even though nothing is functionally broken today. |

## inspiration.service.ts — `inspiration`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /inspiration | `inspiration.list` | inspiration-workspace.tsx | OK | |
| get | GET /inspiration/:id | `inspiration.get` | *(none found)* | DEAD-CLIENT-METHOD | Item detail is opened from the row object already returned by `inspiration.list()`. |
| create | POST /inspiration | `inspiration.create` | inspiration-workspace.tsx | OK | |
| update | PATCH /inspiration/:id | `inspiration.update` | inspiration-workspace.tsx | OK | |
| remove | DELETE /inspiration/:id | `inspiration.remove` | inspiration-workspace.tsx | OK | |

## integration.service.ts — `integrations`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /integrations | `integrations.list` | settings/integrations, settings/setup | OK | |
| update | PATCH /integrations/:platform | `integrations.update` | integrations-panel.tsx | OK | |
| test | POST /integrations/:platform/test | `integrations.test` | integrations-panel.tsx | OK | |

## integrity-guard.service.ts — `integrityGuard`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| findings | GET /integrity/findings | `integrityGuard.findings` | data-quality-workspace.tsx | OK | |

## logistics-issue.service.ts — `logisticsIssues`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /shipments/:id/issues | `logisticsIssues.list` | shipment-detail-sheet.tsx | OK | |
| create | POST /shipments/:id/issues | `logisticsIssues.create` | shipment-detail-sheet.tsx | OK | |
| resolve | POST /logistics-issues/:id/resolve | `logisticsIssues.resolve` | shipment-detail-sheet.tsx | OK | |
| cancel | POST /logistics-issues/:id/cancel | `logisticsIssues.cancel` | shipment-detail-sheet.tsx | OK | |

## note.service.ts — `notes`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| listForInfluencer | GET /influencers/:id/notes | `influencers.notes` | notes-panel.tsx | OK | |
| listForBrand | GET /brands/:id/notes | `notes.forBrand` | *(none found — `brand-notes-card.tsx` uses `CommentThread` → generic `notes.list({brandId})`)* | DEAD-CLIENT-METHOD | Superseded by the generic context-thread endpoint that every other comment surface uses. |
| listForContent | GET /content/:id/notes | `notes.forContent` | *(none found — content notes also go through generic `notes.list({publishedContentId})` via `CommentThread`)* | DEAD-CLIENT-METHOD | Same as `listForBrand`. |
| list | GET /notes | `notes.list` | comment-thread.tsx (the shared Collaboration Layer read path) | OK | |
| create | POST /notes | `notes.create` | comment-thread.tsx | OK | |
| update | PATCH /notes/:id | `notes.update` | comment-thread.tsx | OK | |
| editBody | PATCH /notes/:id/body | `notes.editBody` | comment-thread.tsx | OK | |
| pin | PATCH /notes/:id/pin | `notes.pin` | comment-thread.tsx | OK | |
| remove | DELETE /notes/:id | `notes.remove` | comment-thread.tsx, notes-panel.tsx | OK | |
| listMentionsForUser | GET /notes/mentions | `notes.mentions` | *(none found)* | **NO-UI-gap** | Real gap. Full @mention tagging exists in every comment composer (users.directory-backed picker), but there is no "messages that mention me" inbox/page anywhere to actually read what you were tagged in. |
| markConversationRead | POST /notes/conversations/read | `notes.markConversationRead` | comment-thread.tsx | OK | |
| unreadCounts | GET /notes/conversations/unread | `notes.unreadCounts` | `apps/web/src/lib/use-conversation-unread.ts` | OK | |

## notification.service.ts — `notifications`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /notifications | `notifications.list` | notification bell/dropdown | OK | |
| unreadCount | GET /notifications/unread-count | `notifications.unreadCount` | notification bell badge | OK | |
| markRead | POST /notifications/read | `notifications.markRead` | notification bell/dropdown | OK | |

## platform.service.ts — `platform`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| features | GET /platform/features | `platform.features` | settings/platform | OK | |
| modules | GET /platform/modules | `platform.modules` | settings/platform | OK | |
| status | GET /platform/status | `platform.status` | settings/platform | OK | |
| storageStatus | GET /platform/storage | `platform.storage` | settings/storage | OK | |
| auditLog | GET /platform/audit | `platform.audit` | settings/audit | OK | |
| endpoints | GET /platform/endpoints | `platform.endpoints` | settings/platform | OK | |
| clientConfig | GET /client-config | `clientConfig.get` | `apps/web/src/app/(app)/layout.tsx` (app bootstrap) | OK | |
| isMaintenanceActive | *(none)* | *(none)* | `apps/api/src/app.ts` — gates **every** incoming request | OK | Middleware-only by design. |
| getFlags | GET /platform/flags | `platform.flags` | settings/platform (feature flags panel) | OK | |
| setFlag | PATCH /platform/flags/:key | `platform.setFlag` | settings/platform | OK | |
| getAppVersions | GET /platform/app-versions | `platform.appVersions` | *(none found)* | NO-UI-internal | No mobile app exists anywhere in this repo (`apps/` only has `api`, `web`, `worker`) — these rules gate rollout for a mobile client that hasn't shipped yet. Plausible to defer the admin UI until it does, though worth building before mobile launch. |
| updateAppVersion | PATCH /platform/app-versions/:platform | *(none)* | *(none found)* | **NO-CLIENT** | Same mobile-future context as `getAppVersions` — no client wrapper either. Flag together when mobile ships. |
| updateClientConfig | PATCH /platform/client-config | `platform.updateClientConfig` | *(none found)* | **NO-UI-gap** | Significant real gap: `isMaintenanceActive()` gates every single API request, yet there is **no** UI anywhere to actually flip maintenance mode on, or edit upload limits — the settings/platform page only reads status/flags/audit, never writes client-config. An operator locked into needing maintenance mode currently has no way to enable it short of a direct API call. |

## provider.service.ts — `providers`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| capabilities | GET /integrations/capabilities | `integrations.capabilities` | *(none found in web — but called directly by the worker)* | DEAD-CLIENT-METHOD (web) | `integration.service.ts`'s `list()` already embeds the same per-platform capabilities into `IntegrationDTO.capabilities`, which `integrations-panel.tsx`/`settings/setup` read directly — the standalone route+client is redundant for web. **However** `apps/worker/src/processors.ts` (`findStaleAccountIds`) calls `services.providers.capabilities()` directly (not via HTTP), so the underlying service function is very much alive; only the HTTP-exposed path is unused by web. |
| resolve | POST /influencers/resolve | `influencers.resolve` | new-influencer / resolve-profile flow | OK | |
| adapterCtx | *(none)* | *(none)* | internal, used only within `provider.service.ts` itself | OK | |

## report.service.ts — `reports`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| generate | GET /reports | `reports.generate` / `reports.csvUrl` | reports page | OK | |

## saved-view.service.ts — `savedViews`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| list | GET /saved-views | `savedViews.list` | saved-views.tsx | OK | |
| get | GET /saved-views/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | A saved view can never be opened/deep-linked by id — only listed. |
| create | POST /saved-views | `savedViews.create` | saved-views.tsx | OK | |
| update | PATCH /saved-views/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | A saved view can never be renamed or have its sharing (`isShared`) toggled — only created fresh or deleted. Real, fairly small but genuine gap. |
| remove | DELETE /saved-views/:id | `savedViews.remove` | saved-views.tsx | OK | |

## script.service.ts — `scripts`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| create | POST /scripts | `scripts.create` | ScriptsTab (campaign workspace) | OK | |
| addVersion | POST /scripts/:id/versions | `scripts.addVersion` | ScriptsTab | OK | |
| detail | GET /scripts/:id | `scripts.get` | *(none found)* | DEAD-CLIENT-METHOD | `campaigns.scripts(id)` already returns each `ScriptDTO` with its full version history embedded; `ScriptsTab` expands that in place rather than re-fetching. |
| listForCampaign | GET /campaigns/:id/scripts | `campaigns.scripts` | ScriptsTab | OK | |

## search.service.ts — `search`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| search | GET /search | `search.query` | command-palette.tsx | OK | |
| searchPage | GET /search/page | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | Route summary: "Full ranked, paginated search page (indexes notes + tags) (W3-6)." Fully built server-side, but there is no `/search` results page anywhere in `apps/web/src/app` — only the lightweight Cmd+K command palette (which uses the plain `search` endpoint) exists. A dedicated, shareable search-results page was apparently planned (hence the distinct paginated endpoint) but never built. |

## shipment.service.ts — `shipments`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| get (returned as `get`) | GET /shipments/:id | `shipments.get` | *(none found)* | DEAD-CLIENT-METHOD | Shipment detail sheet is opened from the row already fetched via `shipments.list()`/`campaigns.shipments()`. |
| listForCampaignInfluencer | GET /campaign-influencers/:id/shipments | `campaignInfluencers.shipments` | *(none found)* | DEAD-CLIENT-METHOD | `shipments-tab.tsx` fetches the whole-campaign list via `campaigns.shipments(campaignId)` (i.e. `listForCampaign`) and filters client-side per participation, rather than calling this more specific endpoint. |
| listForDeliverable | GET /deliverables/:id/shipments | `deliverables.shipments` | campaigns/[id]/workspace.tsx (`DeliverableShipmentsAction` — Deliverable→Shipment nav, FC-4) | OK | Was dead at audit time; the route/client method/UI caller were added concurrently by a parallel work-stream (Final Completion Pass gap #9) and landed after this table was first drafted. Corrected post-hoc — not a re-run of the full audit. Note: `submission.service.ts` has its own, unrelated, `listForDeliverable` — see the submissions table below; don't confuse the two. |
| listForCampaign | GET /campaigns/:id/shipments | `campaigns.shipments` | shipments-tab.tsx | OK | |
| listAll | GET /shipments | `shipments.list` | logistics-workspace.tsx | OK | |
| summary | GET /shipments/summary | `shipments.summary` | logistics-workspace.tsx (country strip) | OK | |
| create | POST /campaign-influencers/:id/shipments | `campaignInfluencers.createShipment` | shipments-tab.tsx | OK | |
| update | PATCH /shipments/:id | `shipments.update` | shipment-detail-sheet.tsx | OK | |
| updateStatus | POST /shipments/:id/status | `shipments.updateStatus` | shipment-detail-sheet.tsx | OK | |
| assign | POST /shipments/:id/assign | `shipments.assign` | shipment-detail-sheet.tsx / logistics-workspace.tsx | OK | |

## social-account.service.ts — `socialAccounts`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| create | POST /influencers/:id/social-accounts | `influencers.addSocialAccount` | social-accounts-panel.tsx | OK | |
| update | PATCH /social-accounts/:id | `socialAccounts.update` | social-accounts-panel.tsx | OK | |
| sync | POST /social-accounts/:id/sync | `socialAccounts.sync` | social-accounts-panel.tsx; also the worker's `syncAccount()` job | OK | |
| remove | DELETE /social-accounts/:id | `socialAccounts.remove` | social-accounts-panel.tsx | OK | |
| snapshot | *(none)* | *(none)* | internal — called by `create`/`update`/`sync` within `social-account.service.ts` itself | OK | Additive follower-history helper, not a standalone action. |

## sourcing.service.ts — `sourcing`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| listForCampaign | GET /campaigns/:id/candidates | `campaigns.candidates` | sourcing-tab.tsx | OK | |
| get | GET /candidates/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | See combined note below. |
| add | POST /campaigns/:id/candidates | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | See combined note below. |
| update | PATCH /candidates/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | See combined note below. |
| decide | POST /candidates/:id/decision | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | See combined note below. |
| convert | POST /candidates/:id/convert | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | See combined note below. |
| remove | DELETE /candidates/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | **Combined note for the whole `sourcing` service (minus `listForCampaign`):** `sourcing-tab.tsx`'s own comment says "Read-only, plus a bulk CSV creator intake" — this is an intentional, documented product decision, not an oversight. But it means the entire single-candidate lifecycle (add one creator, edit fit score/notes, shortlist/approve/reject with a reason, and — critically — **convert** an approved candidate into an actual campaign-roster member) has zero client methods and zero UI, despite full route support. `convert` is the one action that actually commits a candidate to the roster; without it (or any per-candidate decision UI), the sourcing pipeline can only ever reach "imported via CSV, sitting at PENDING/UNDECIDED forever" from the web app. This is the single largest concrete backend-vs-UI gap found in this audit. |

## submission.service.ts — `submissions`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| listForDeliverable | GET /deliverables/:id/submissions | `deliverables.submissions` | *(none found)* | DEAD-CLIENT-METHOD | `submissions-tab.tsx` uses the whole-campaign `campaigns.submissions(id)` list instead of fetching per-deliverable. |
| listForCampaign | GET /campaigns/:id/submissions | `campaigns.submissions` | submissions-tab.tsx | OK | |
| get | GET /submissions/:id | `submissions.get` | *(none found)* | DEAD-CLIENT-METHOD | Submission detail is opened from the row already present in the campaign-wide list. |
| create | POST /deliverables/:id/submissions | `deliverables.submit` | campaign workspace (submit draft) | OK | |
| review | POST /submissions/:id/review | `submissions.review` | submissions-tab.tsx | OK | |
| addComment | POST /submissions/:id/comments | `submissions.addComment` | submissions-tab.tsx | OK | |

## usage-right.service.ts — `usageRights`

| Function | Route | Client Method | Web UI Caller(s) | Classification | Notes |
|---|---|---|---|---|---|
| listForBrand | GET /brands/:id/usage-rights | `brands.usageRights` | usage-rights-card.tsx | OK | |
| get | GET /usage-rights/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | No detail view for a single usage right. |
| create | POST /brands/:id/usage-rights | `brands.createUsageRight` | *(none found)* | **NO-UI-gap** | `usage-rights-card.tsx`'s own comment says "Read-only; server-rendered" — a deliberate design choice, but one with real operational cost: there is **no way to record a new usage-rights license from the web app at all**, despite `brands.createUsageRight` existing as a fully working client method. Licenses can currently only enter the system however the seed/import data got there. |
| update | PATCH /usage-rights/:id | *(none)* | *(none found)* | **NO-CLIENT / NO-UI-gap** | No client method either — can't correct/extend a recorded license from the UI. |
| revoke | POST /usage-rights/:id/revoke | `brands.revokeUsageRight` | *(none found)* | **NO-UI-gap** | Same "Read-only" design choice — no way to revoke a license (e.g. on a legal dispute) from the web app, despite the worker actively alerting on expiring rights and a working `revoke` client method sitting unused. |

---

## Most concerning findings (ranked)

1. **Sourcing/candidate pipeline is a UI dead-end past "list" and "bulk CSV import."** `sourcing.add/get/update/decide/convert/remove` have working routes but zero client methods and zero UI. `convert` — the action that actually turns a candidate into a campaign-roster member — cannot be triggered from the web app at all. This is the single largest concrete gap in the audit.
2. **Usage-rights (content-licensing) ledger is entirely read-only in the web app.** `create`, `update`, and `revoke` either have no UI caller or no client method at all, despite the worker actively generating expiry-warning notifications against this same data. There is no way to record or revoke a license from the product.
3. **No password-reset path exists in the UI**, admin or self-service. `POST /users/:id/reset-password` has a working client method (`users.resetPassword`) with zero callers.
4. **No maintenance-mode toggle.** `isMaintenanceActive()` gates every single API request, but `platform.updateClientConfig` (the only way to flip it) has no UI caller anywhere.
5. **Brand↔influencer relationship linking (`brandInfluencers.upsert`/`.remove`) has no UI** — relationships are shown read-only on the influencer profile with no way to create or remove them.
6. **Manual content metrics (`content.addManualMetrics`) and metric history (`content.metricsHistory`) have no UI**, despite the route being explicitly built for "platforms without an official API" — a real, named use case.
7. **Bulk roster operations (`bulk.addInfluencers`, `bulk.applyDeliverableTemplate`) have no client method at all**, let alone UI — influencers can only be added to a campaign one at a time from the web app despite a "W3-4" bulk-roster feature existing server-side.
8. **@mentions have no inbox.** Users can tag each other in any comment thread, but `notes.listMentionsForUser` (`notes.mentions`) is never called — there's no page to see "what I was mentioned in."
9. **No dedicated, shareable search-results page.** Only the Cmd+K quick-search (`search.search`) is wired; the paginated, ranked `search.searchPage` ("indexes notes + tags," W3-6) is unused.
10. **One genuinely dead service function with no callers anywhere** (safe-to-remove candidate, not a gap): `brandInfluencer.service.ts`'s `get`. (`shipment.service.ts`'s `listForDeliverable` was dead at audit time but gained a route/client/UI caller from a concurrent work-stream — see the shipment table above; no longer dead.) A second, `creatorOAuth.service.ts`'s `accessToken`, is dead but was clearly built ahead of a not-yet-wired metrics-fetcher feature (its own comment says so) — worth keeping and finishing rather than deleting.
11. **A cluster of ~14 `api-client` methods are redundant, not broken** (`brands.get`, `scripts.get`, `shipments.get`, `inspiration.get`, `submissions.get`, `campaignInfluencers.get`/`.shipments`, `deliverables.submissions`, `notes.forContent`/`.forBrand`, `dashboard.whatsNew`, `users.getBrandAccess`/`.getCountryAccess`, `integrations.capabilities`) — every one of them duplicates data the UI already gets from a parent list/detail call it does use. Low-priority client-library cleanup, not a product gap.
