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

## Instagram — profile only (Meta app + Business account)

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

**What this gives you:** auto profile lookup (name, avatar, bio, followers) for
*Professional target accounts only*. Personal accounts stay manual.

**What it does NOT give you:** likes/comments/views of an arbitrary creator's
posts. Meta does not expose per-post metrics to a third party without the
creator authorizing your app (see Creator-OAuth below). Instagram post numbers
are entered manually until then.

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
URI, privacy policy and business verification. The code foundation for this
(encrypted token storage, OAuth start/callback, authorized-fetch paths) ships
gated behind app credentials and is inert until you complete that review — it
cannot be exercised end-to-end without approved apps. This is a platform
constraint, not a limitation of the codebase.
