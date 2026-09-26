# AI assistance

Claude (Anthropic) helps in a few places. It is **off by default** and does
nothing until an admin turns it on in **Settings → AI**. Every answer is a
suggestion: a person checks it, and nothing is saved until they save.

## Turning it on (Settings → AI, admins only)

- **Claude API key** — from the Anthropic console. Stored encrypted (like the
  platform keys, with `ENCRYPTION_KEY`, re-sealed by the reseal script); the
  page shows only its last four characters. `ANTHROPIC_API_KEY` in the server
  environment is used when none is saved here.
- **Model ID** — typed exactly as the Anthropic account shows it (the app has
  no model built in, so the agency picks and changes it without a release).
  It must read images for screenshot reading. `AI_MODEL` in the environment is
  used when none is saved here.
- **Switches** — AI on/off, and each feature: reading screenshots, writing
  help. Turning AI on without a key and a model is refused.
- **Monthly limit** — one limit for all features per calendar month (Kuwait
  time), 300 by default. Answered and declined requests count; failed ones
  don't. The page shows this month's use by feature.

What is sent: only the screenshot or text the request needs. What is kept:
one row per request — who, which feature, which post/campaign, tokens, and
whether it worked — never the image or text (`AiRequest`).

Errors are plain and translated: AI off, feature off, limit reached, key
refused, model not found, service busy, declined, or an answer that couldn't
be used.

## Built: read metrics from an insights screenshot (P3.2)

In **Enter metrics** (a post's numbers), once a screenshot is attached:

- **"Read the numbers with AI"** — the server loads the attachment from
  storage (never a URL from the browser), checks it belongs to the post and is
  a PNG/JPEG/WebP/GIF of at most 5 MB, and asks Claude for views, likes,
  comments, shares and saves — plus the date, only when the screen shows the
  date the numbers were for — as structured output.
- The form is filled in and the filled boxes are marked until edited; the
  "numbers as of" date is set when read. A number the screenshot doesn't show
  stays empty (never a guess). An image that isn't an insights screen fills
  nothing and says so. Claude's note (e.g. "saves are cut off") is shown in the
  reader's language.
- Needs CONTENT_MANAGE and the post in the reader's brands/countries.

API: `GET /api/v1/ai/status`, `GET|PATCH /api/v1/platform/ai` (admin),
`POST /api/v1/content/:id/metrics/read-screenshot { attachmentId, locale }`.

## Built: writing help (P3.5)

Same switch, key and limit, under "Writing help". Only people who could do
the thing by hand see the button.

- **Script draft** — in "New script" and "Add version": "Write the draft"
  writes a first draft from the campaign brief (with the deliverable's
  platform, format and requirements, and — for a new version — the script's
  current text and the brand's feedback), in Arabic or English, with a
  caption suggestion. The deliverable's required hashtags and mentions are
  always kept. It fills the form; the team edits and saves. Needs
  CAMPAIGNS_MANAGE.
- **Draft review notes** — in a creator's draft review: "Suggest notes with
  AI" reads the brief, the approved script, the caption check and the draft's
  caption, notes and image (it can't watch videos or open links) and suggests
  specific notes, which one click puts in the review note. The reviewer
  decides. Needs UGC_REVIEW.
- **Report summary** — in "Edit campaign": "Write with AI" writes the client
  report's summary from the same figures the reader's report shows (no costs
  without finance access). Needs CAMPAIGNS_MANAGE.

Nothing is sent to creators or clients automatically.

API: `POST /api/v1/campaigns/:id/scripts/ai-draft`,
`POST /api/v1/submissions/:id/ai-review`,
`POST /api/v1/campaigns/:id/report/ai-summary`.
