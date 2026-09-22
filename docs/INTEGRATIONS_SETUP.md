# Social Integrations — Setup Runbook

How to turn the social provider integrations from **manual-fallback** (the
default) into **live official-API** mode, per platform. The app works fully
without any of these; each credential simply upgrades one platform from
"enter data manually" to "auto-fetched".

Credentials are **server-side only** — they are read from environment variables
by the API and worker (never sent to the browser, never written to the database
in the default setup). See `docs/SOCIAL_PROVIDER_MATRIX.md` for the capability
ceiling of each platform (auto-generated from the code).

> Where each var goes: local dev → `.env`; production → your secret store /
> `.env.production`; both are enumerated in `.env.example` /
> `.env.production.example`.

## Verify readiness at any time

```bash
# 1. Per-platform capability + whether the official API is active right now:
curl -s "$API/api/v1/integrations/capabilities" -H "authorization: Bearer $TOKEN"
#    → look for "apiConfigured": true on the platform you configured.

# 2. A live resolve of a real profile (proves the fetch path end to end):
curl -s -X POST "$API/api/v1/influencers/resolve" -H "authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' \
     -d '{"input":"https://www.youtube.com/@mkbhd","platform":"YOUTUBE"}'
#    → source:"OFFICIAL_API" with real numbers = live; source:"MANUAL" = not configured.
```

The admin **Integrations** screen also shows each platform's status and a
"test connection" action.

---

## YouTube — turnkey (recommended first)

Auto-fetches channel stats (subscribers, video count) and **video metrics
(views / likes / comments)**, both on add and on every scheduled refresh.

1. Google Cloud Console → create/select a project.
2. Enable **YouTube Data API v3**.
3. Create an **API key** (APIs & Services → Credentials). Restrict it to the
   YouTube Data API.
4. Set `YOUTUBE_API_KEY="<key>"` and restart the API + worker.

No OAuth, no review. This is the only platform that gives full content metrics
with just a key.

## X (Twitter) — key only, plan-dependent

Auto-fetches profile `public_metrics` and tweet metrics (likes, replies,
retweets, quotes, impressions) **subject to your API access tier**.

1. X Developer Portal → project/app → **Bearer Token** (App-only auth).
2. Set `X_API_BEARER_TOKEN="<token>"` and restart.

Note: the free tier is very limited; public metrics availability depends on the
tier. A `403` from X surfaces as "requires app authorization" in the app.

## Instagram — profile + post likes/comments (Meta app + Business account)

The Instagram Graph API exposes data **only for eligible Professional
(Business/Creator) accounts**, reached through the **Business Discovery** edge,
which runs through *your own* connected IG Business account.

1. Connect an Instagram **Business/Creator** account to a Facebook Page you own.
2. Meta for Developers → create an app → add **Instagram Graph API**.
3. Generate a long-lived **access token** with the required permissions
   (`instagram_basic`, `pages_read_engagement`, and Business Discovery access).
   Set `INSTAGRAM_ACCESS_TOKEN`.
4. Find your connected **IG Business account id** and set
   `INSTAGRAM_BUSINESS_ACCOUNT_ID`. **Both** vars are required — with only one,
   `apiConfigured` stays `false`.
5. (App id/secret — `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` — are for the
   creator-OAuth foundation, not needed for Business Discovery.)

> **Pick the right setup path.** Under the Instagram product Meta offers
> *"API setup with Instagram login"* and *"API setup with Facebook login"*.
> Business Discovery exists **only on the Facebook login path**
> (`graph.facebook.com`); the Instagram login path (`graph.instagram.com`) has
> no such edge, and no token or permission fixes that. Instagram Basic Display
> API was shut down on 2024-12-04 — any guide built on it is dead.

Token permissions: `instagram_basic`, `instagram_manage_insights`,
`pages_read_engagement`, plus `pages_show_list` for the `/me/accounts` step
(and `ads_management` or `ads_read` if the Page role came via Business Manager).

**Order matters:** exchange the short-lived user token for a long-lived one
*before* calling `/me/accounts`. A Page token derived from a short-lived user
token inherits that short expiry and dies within the hour; one derived from a
long-lived user token does not expire.

No App Review or Business Verification is needed while the app serves only
people who hold a role on it — the influencers being looked up never log in and
do not affect the access level.

**What this gives you:** auto profile lookup (name, avatar, bio, followers) for
*Professional target accounts only*, plus **per-post likes, comments and — for
Reels — `view_count`** on those accounts' **recent** posts, read from the
Business Discovery `media` edge.

Post metrics resolve by matching the tracked post's shortcode against the
owning account's recent `permalink`s, so they need the influencer to have a
`SocialAccount` row for Instagram — that handle is what Business Discovery runs
against (an Instagram post URL carries no username). A post older than the
media window returns `NOT_FOUND` and keeps whatever was entered manually.

**What it does NOT give you:**

- **Anything at all for personal accounts.** They are not discoverable, so they
  stay fully manual.
- **Older posts**, which fall outside the recent-media window. There is no
  endpoint that resolves a post URL to a media id, and a media id returned by
  Business Discovery cannot be fetched directly ("performing a `GET` on any
  returned IG Media will fail due to insufficient permissions"), so every field
  must come back through field expansion on the one Business Discovery call.
- **`like_count` when the owner hides like counts** — under field expansion Meta
  omits the field instead of erroring, so it reads as null.
- **Views on anything but Reels.** `view_count` is Reels-only and mixes paid
  with organic reach; `total_views_count` is explicitly unavailable here.

TikTok still requires the creator authorizing your app — see Creator-OAuth below.

## TikTok — embed + availability only

Public video **embed** and an availability check (via public oEmbed) work with
no credentials. Profile and video **statistics require creator OAuth** (Login
Kit / Display API) — see below. `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`
are placeholders for that OAuth foundation.

## Snapchat — manual

No public profile/content API. Snapchat is URL/manual-based; availability is a
best-effort link check only.

---

## Creator-OAuth (Instagram / TikTok post metrics)

Fetching a creator's **own** post/video metrics requires that creator to
authorize the app through the platform's OAuth flow, and requires the app to
pass the platform's **app review** (Meta / TikTok) with an approved redirect
URI, privacy policy and business verification.

The code foundation for this ships and is wired end to end (INT-3):

- **Endpoints** — `POST /influencers/:id/creator-connections/:platform/start`
  returns the authorize URL; `GET /integrations/:platform/oauth/callback`
  exchanges the code and stores the token (sealed, AES-256-GCM);
  `GET /influencers/:id/creator-connections` lists connections;
  `DELETE …/:platform` disconnects. TikTok uses PKCE (S256); state is sealed and
  short-lived (10 min).
- **Metric fetchers** — `fetchInstagramMediaMetrics` / `fetchTikTokVideoMetrics`
  (in `@influenceos/shared`) turn a stored creator token into real post metrics.
  These are unit-tested with a mocked fetch.

To activate:

1. Create the Meta / TikTok app, complete **app review** for the insight scopes.
2. Register the redirect URI: `<OAUTH_CALLBACK_BASE_URL>/api/v1/integrations/<platform>/oauth/callback`.
3. Set the app credentials (`INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`,
   `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`) and `OAUTH_CALLBACK_BASE_URL`.

Until then `start` refuses with a clear "not configured" message rather than
pretending. **This is a platform constraint (app review), not a code gap** — the
flow, storage and fetchers are in place; only the reviewed app + wiring the
stored token into the periodic refresh remain, and that last wiring is
intentionally left until a real token exists to validate it against.
