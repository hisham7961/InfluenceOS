# InfluenceOS — Influencer & UGC Expert Council Review

**Audit HEAD:** `85b6c852` · Council: Influencer-Marketing CTO, UGC Operations Director, Creator-CRM expert, Campaign-Ops Director, Finance/Payments, Product-Seeding, Content-Rights, Analytics/ROI, Executive/CMO, Global-Ops. Every current-state claim is proven from schema/services/pages.

## 1. Can it run a real influencer operation? (CTO + Agency Ops)
**Yes for tracking, no for running the front and middle of the funnel.** It can hold thousands of creators and many brands, monitor live posts, track deal types and costs, and report — but the day-to-day agency workflow (source → shortlist → negotiate → contract → ship product → brief → collect draft → review → revise → approve → schedule → publish → pay → track rights) is only supported from "publish" onward. Everything before "creator is on the roster with an agreed cost" and the entire content-review middle happen off-platform.

## 2. Full real-world campaign lifecycle vs InfluenceOS
| Stage | Supported? | Evidence / gap |
| --- | --- | --- |
| Brief | Partial | one campaign-level text blob + campaign-level scripts; no per-deliverable/structured brief, hooks, shot list, moodboard |
| Creator sourcing / shortlist | **No** | no candidate pool; adding to roster is an immediate commit (DB-10 corrupts relationship stats) |
| Selection / negotiation | **No** | pipeline stages exist but no in-app outreach, no rate history, no negotiation log |
| Contract | **No** | no contract entity/status/signature; attachments are generic files |
| Product shipping / seeding | **No** | gifting is money-only; no address/courier/tracking/delivered |
| Content due / deadlines | Yes | deliverable `dueDate`, calendar, deadline notifications |
| First draft / revisions / approval | **No** | no draft submission, revision rounds, review comments, or approval history/states |
| Scheduled date → publication | Partial | statuses model "sent → awaiting publication → published" but "published" = a live public social URL only |
| Monitoring / metrics | Yes | worker every 30 min; YouTube/X auto-sync; IG/TikTok/Snap manual |
| Payment | Partial | status enum only; no paid-amount, partial payment mis-bucketed, no payable/ledger |
| Usage-right expiry | **No** | no rights record, no expiry alerts |
| Retrospective | **No** | no campaign wrap/retro, no repeat-collaboration performance |

## 3. UGC production — verdict: **NOT supported today**
InfluenceOS hard-codes "deliverable complete" = "creator posted a live public social URL" (`content.service.ts:86-89,144-155`; `progress.ts:31-42`). A genuine UGC deliverable (an owned asset file, no public post) **cannot reach `PUBLISHED`** through the intended flow, so progress/reporting misrepresent UGC campaigns. There is no draft/review/approval loop, no owned-asset library, no usage-rights ledger, no variant handling (aspect/language/voiceover/subtitle), and no seeding logistics. **Do not treat "influencer campaign" and "UGC production" as the same workflow** — they diverge at the deliverable model.

**UGC/rights/gifting must-haves (in scope for an internal tool):**
1. Draft submission + review/approval workflow (MUST, P1) · 2. Revision rounds + review comments + approval history (MUST, P1) · 3. Usage-rights record — whitelisting, paid-ad/organic, territory, duration, exclusivity, competitor restriction (MUST, P1) · 4. License/content expiry + **alerts** (MUST, P1, reuses the notification worker) · 5. Seeding shipment tracking (SHOULD, P1/P2) · 6. Owned-asset/final-asset store distinct from live posts & raw drafts (SHOULD, P2) · 7. Gift↔content-obligation link + no-obligation seeding (SHOULD, P2) · 8. UGC variants (SHOULD, P2) · 9. Disclosure + takedown obligation record (SHOULD, P2) · 10. `kind` enum RAW_FOOTAGE/DRAFT/FINAL on attachments (SHOULD, P3).

## 4. Creator CRM sufficiency
Strong: relationship pipeline (global + per-brand), notes, tags, metric provenance, derived rate/deliverable history. **Missing:** relationship owner on the creator, reliability/responsiveness/quality score, internal rating, consent/PII provenance on stored contact data, and surfacing existing `Attachment.influencerId` in the 360 (data model ready, UI absent). Also: `managerName/managerContact/preferredContact/pricingNotes/internalNotes` exist in the model but are **not editable in the 360 edit dialog** (create/API only) — a P3 UI-only fix. **Avoid CRM bloat:** no forecast pipeline, no inbox sync, no lead-scoring automation, no custom-field engine.

## 5. Executive visibility — 6 of 11 questions answerable today
| Question | Answerable? |
| --- | --- |
| What campaigns are live? | ✅ |
| What is late/overdue? | ✅ |
| How much are we spending (vs budget)? | ✅ spend; ❌ **vs budget** (no budget comparison KPI) |
| What needs attention? | ✅ |
| What is due this week? | ✅ |
| What content was removed/taken down? | ✅ |
| What content went live **today**? | ❌ dashboard is 7-day/weekly, no today scope |
| Which creators are **strongest**? | ❌ no leaderboard |
| Which creators **underperformed**? | ❌ |
| Which **brands** have issues? | ❌ no cross-brand rollup |
| What **changed since yesterday**? | ❌ activity is a rolling last-10, no digest |

## 6. Finance & ROI (Finance + Analytics)
**Real ROI is NOT possible with current captured data** — the model records **cost + reach/engagement only**, with no revenue/conversion/sales signal (`CONVERSIONS` is merely an objective label), so any ROI/ROAS would be invented (do not fabricate). **Spend efficiency** (CPV/CPM/CPE/completion) *is* computable today but is barely surfaced (one campaign tab, computed in the browser) and data-quality-limited (most metrics manual, freshness never shown). Finance gaps: partial payment mis-tracked (P1), no payment workflow beyond a status enum (P1), mixed-currency mis-summation (P1/P2), no invoice capture/link (P2), no payment due date (P2). Keep it an **operational finance layer**, not accounting software — tax/VAT, agency fee, cost center are OPTIONAL/NOT-NEEDED; EMV is **not definable** without reference-rate data (do not add).

## 7. Priority call for the product roadmap
The single highest-leverage build is the **content review/approval + revision workflow (#1)** — it unlocks genuine UGC, makes "approved" auditable, and feeds calendar/notifications with the stages that are today invisible. Pair it with **usage-rights + expiry alerts (#2)** (legal risk) and the **partial-payment fix (#3)** (reporting integrity). Everything else is sequenced in `AUDIT_MASTER_PLAN.md`.
