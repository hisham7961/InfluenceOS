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
