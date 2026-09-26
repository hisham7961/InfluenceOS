# AI features — ready to build, waiting on a decision

Two planned features call Claude: reading the numbers from an insights
screenshot (P3.2) and writing help for briefs, captions and outreach (P3.5).
Both are **off by default** and are **not built yet**, because they need three
things only the owner can decide:

1. **A new dependency.** Claude is called through the official Anthropic SDK
   (`@anthropic-ai/sdk`), not hand-written HTTP. Adding it means installing a
   new npm package and updating `pnpm-lock.yaml`.
2. **An API key.** Stored like the other provider keys: Settings →
   Integrations (encrypted with `ENCRYPTION_KEY`), or `ANTHROPIC_API_KEY` in
   `.env`.
3. **A monthly limit.** How many AI requests a month the agency will pay for
   (each screenshot read is one request; the cost depends on the model).

## Design (P3.2 — read metrics from a screenshot)

The metrics dialog already accepts an insights screenshot as an attachment
(P1.1). The AI step only adds a button:

- **"Read the numbers"** next to an attached image. The server loads the image
  from object storage (never from a URL the browser sends), and asks Claude to
  return views, reach, likes, comments, shares, saves and the date shown —
  through a strict tool schema, so the answer is always structured.
- The result **pre-fills** the form; nothing is saved until a person checks it
  and presses Save. Values the model couldn't see stay empty (never a guess or
  a zero). The saved snapshot is marked as entered by hand from a screenshot.
- Model: `claude-opus-5` (Anthropic's current default), adaptive thinking,
  `max_tokens` ≈ 1,000, with server-side refusal fallback.
- Guard rails: an admin switch (off by default), the monthly limit counted in
  the database (the button is hidden when it's reached), only people with
  CONTENT_MANAGE, brand scope as everywhere, images only (PNG/JPEG/WebP, ≤ 5 MB),
  and every request logged (who, which post, tokens used) without storing the
  image text.
- API: `POST /api/v1/content/:id/metrics/read-screenshot { attachmentId }` →
  suggested values + which ones were found; `GET /api/v1/platform/ai` for the
  switch, limit and this month's use.

## Design (P3.5 — writing help)

Same switch, key and limit. Suggestions only, shown next to the field:
a campaign brief from the objective and product notes, caption ideas that keep
the required hashtags and mentions, and a polite outreach message in Arabic or
English. Nothing is sent to creators automatically.

## What to tell us

- "Yes, add the Anthropic SDK" (or "no AI").
- Where the key will live (Settings screen or `.env`).
- The monthly request limit (for example 300).
