# Business rules: time, delivery and money

One definition of each rule, used by every screen, report, notification and
the background worker. The code lives in two places:

- `packages/shared/src/utils/business-day.ts` and `deliverable-rules.ts`
  (used by the API, the worker and the web app)
- `packages/domain/src/lib/deliverable-rules.ts` (the same rules as database
  filters) and `packages/domain/src/lib/spend.ts` (money)

## Time

- The business day is the calendar day in **Kuwait** (Asia/Kuwait, UTC+3, no
  daylight saving) — never UTC and never the viewer's browser zone.
- A date entered as a day (due date, campaign start/end, report from/to) is
  stored as 00:00 UTC of that day, which falls on the same day in Kuwait.
- Date ranges include their whole last day: a report "to 30 Sep" includes a
  post at 23:30 on 30 Sep.
- "Today" on the exec page and Live Content is the Kuwait day.

## Deliverables

| Term | Meaning |
|---|---|
| Delivered | Published or Verified. For **UGC** (handed over, not posted) Approved also counts. An approved draft of any other type is cleared to post, not delivered. |
| Closed | Cancelled (off the plan) or Missed (won't happen). |
| Outstanding | Neither delivered nor closed. Only outstanding work can be overdue or "due today". |
| Overdue | Outstanding, and its due day has **fully passed** in Kuwait. Something due today turns overdue at midnight, not at 03:00. |
| Completion % | Delivered ÷ every deliverable except cancelled ones. Missed work stays in the count. |

Due-soon notifications cover today, tomorrow and the day after. A post is on
time if it went up any time on its due day.

## Money

- A creator's fee is the roster's **agreed cost** on a paid deal.
- A creator who **declined or dropped out** adds only what was actually paid
  to them.
- An "Influencer fee" expense for a creator whose agreed cost is already on
  the roster would count the fee twice: new ones are refused, and older ones
  are left out of the totals.
- **Spend** = creator fees + all other expenses except gift products (gift
  value is shown separately).
- **Paid / unpaid** cover everything owed (fees, expenses, gift purchases):
  paid in full counts in full, a part payment counts what was recorded as
  paid, "not applicable" counts as neither.
- "Total paid" to a creator includes part payments.

## Checking posts (P3.4)

The worker re-checks every live post (availability, then numbers) on a gap
that follows the post's age (`packages/domain/src/lib/check-cadence.ts`):

| Post age | Checked every |
|---|---|
| under 1 day | hour |
| 1–3 days | 3 hours |
| 3–14 days | 6 hours |
| 14–30 days | day |
| 30–90 days | 3 days |
| older | week |

While a post's campaign is **active** (or **completed** less than 7 days ago,
while the report is being written) the gap is never longer than 6 hours. A
failed check retries after 1h, 2h, 4h… but never later than the normal gap.
Removed posts and Stories are not checked. A post's page shows when its next
check is due; "Refresh" checks it right away.

## Creator licences (P3.5)

A campaign names the countries it is for (`marketCountryCodes`; new campaigns
start with Kuwait). An admin sets which countries need a creator advertising
licence (Settings → Compliance; Kuwait, Saudi Arabia and the UAE by default).
For each of the campaign's countries on that list, every creator still on the
roster (invited, confirmed, in progress) is checked
(`packages/domain/src/lib/licences.ts`):

| State | Meaning |
|---|---|
| Valid | A licence for that country that lasts past the campaign's end (or has no end date) |
| Missing | No licence recorded for that country |
| Expired | Its end date has passed |
| Ends during | It ends before the campaign does — or within 30 days when the campaign has no end date |

The roster shows this per creator. Needs Attention shows one line per
planning, active or paused campaign whose **confirmed / in-progress** creators
are missing a valid licence (red while the campaign is active) or whose
licences end during it (amber). A licence's own page status is "expiring
soon" within 30 days of its end; the worker warns the creator's owner (or the
whole team) once, 30 days ahead, and again after a renewal changes the date.

## Caption check (P3.5)

A caption (a draft's or a live post's) is checked against its deliverable
(`packages/shared/src/utils/caption-check.ts`, `domain/lib/caption-rules.ts`):

- **Hashtags and mentions**: the deliverable's own plus those of the
  brand-**approved** script version (a draft script can still change). Whole
  tags only (`#glow` doesn't match `#glowup`), ignoring case and the common
  Arabic spelling variants (أ/إ/ا, ة/ه, ى/ي, harakat).
- **Ad disclosure**: required for paid or gifted work the creator posts on
  their own account — every deal except FREE, every type except UGC. Any of
  #إعلان, #اعلان, #إعلان_مدفوع, #مدفوع, #ad, #ads, #advert, #advertisement,
  #sponsored, #paidpartnership, "paid partnership", "إعلان مدفوع",
  "شراكة مدفوعة" counts.

The creator sees the check live while writing the caption on their task
link; the team sees it when reviewing a draft and on the post's page. Needs
Attention shows one red line per **active** campaign with live paid/gifted
posts (not Stories or UGC) whose caption we have and that doesn't say it's an
ad (the newest 500 such posts are scanned).

## My work and approvals (P3.6)

"Mine" is what a person owns: a campaign whose owner they are, or a creator
whose owner they are (either one makes that creator's row on that campaign
theirs). Shipments and address issues are theirs when assigned to them.
Everything stays inside their brand and country scope — owning a campaign in
a brand they can't see doesn't bring it back.

My work lists, per owned row: drafts waiting for review, deliverables past
their due date, deliverables due today or in the next 3 days (Kuwait
calendar), and new found posts per owned campaign; plus open shipments
(pending / shipped / in transit) and open address issues assigned to them.
The Approvals list shows every draft waiting in the person's scope, oldest
first, so drafts nobody owns don't get lost. The sidebar shows both counts,
refreshed every minute.
