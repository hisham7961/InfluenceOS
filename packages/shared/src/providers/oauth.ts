/**
 * Creator-OAuth foundation (INT-3) — pure, testable building blocks for the
 * flows that would let a creator authorize the app to read their OWN post
 * metrics (which Instagram/TikTok do not expose to third parties otherwise).
 *
 * IMPORTANT: nothing here is live until the corresponding platform app passes
 * review (Meta / TikTok) with an approved redirect URI. These helpers only
 * construct the requests and parse the responses; the network calls use an
 * injectable fetch so they are fully unit-tested without real apps or keys.
 *
 * This file is browser-safe (no node:crypto): PKCE/state generation lives
 * server-side in the domain layer and its output is passed in.
 */

// --- Instagram (Facebook Login for the IG Graph API) ----------------------

export const INSTAGRAM_DEFAULT_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
] as const;

export function instagramAuthorizeUrl(opts: {
  appId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  apiVersion?: string;
}): string {
  const v = opts.apiVersion ?? 'v21.0';
  const params = new URLSearchParams({
    client_id: opts.appId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    response_type: 'code',
    scope: (opts.scopes ?? INSTAGRAM_DEFAULT_SCOPES).join(','),
  });
  return `https://www.facebook.com/${v}/dialog/oauth?${params.toString()}`;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null;
  scope: string | null;
  externalUserId: string | null;
  raw: unknown;
}

/** Exchange an IG/Facebook authorization code for an access token. */
export async function exchangeInstagramCode(
  fetchFn: typeof fetch,
  opts: { appId: string; appSecret: string; redirectUri: string; code: string; apiVersion?: string },
): Promise<OAuthTokenResult> {
  const v = opts.apiVersion ?? 'v21.0';
  const params = new URLSearchParams({
    client_id: opts.appId,
    client_secret: opts.appSecret,
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  const res = await fetchFn(`https://graph.facebook.com/${v}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Instagram token exchange failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; token_type?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Instagram token exchange returned no access_token');
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresInSec: data.expires_in ?? null,
    scope: null,
    externalUserId: null,
    raw: data,
  };
}

/** Read post-level insights for one IG media object, using a creator token. */
export async function fetchInstagramMediaMetrics(
  fetchFn: typeof fetch,
  opts: { mediaId: string; accessToken: string; apiVersion?: string },
): Promise<{ likes: number | null; comments: number | null; views: number | null; saves: number | null; reach: number | null; raw: unknown }> {
  const v = opts.apiVersion ?? 'v21.0';
  const metric = 'impressions,reach,likes,comments,saved';
  const res = await fetchFn(
    `https://graph.facebook.com/${v}/${encodeURIComponent(opts.mediaId)}/insights?metric=${metric}&access_token=${encodeURIComponent(opts.accessToken)}`,
  );
  if (!res.ok) throw new Error(`Instagram insights failed: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> };
  const byName = new Map<string, number>();
  for (const m of data.data ?? []) {
    const value = m.values?.[0]?.value;
    if (m.name && typeof value === 'number') byName.set(m.name, value);
  }
  return {
    likes: byName.get('likes') ?? null,
    comments: byName.get('comments') ?? null,
    views: byName.get('impressions') ?? null,
    saves: byName.get('saved') ?? null,
    reach: byName.get('reach') ?? null,
    raw: data,
  };
}

// --- TikTok (Login Kit v2 + Display API) ----------------------------------

export const TIKTOK_DEFAULT_SCOPES = ['user.info.basic', 'video.list'] as const;

export function tiktokAuthorizeUrl(opts: {
  clientKey: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_key: opts.clientKey,
    scope: (opts.scopes ?? TIKTOK_DEFAULT_SCOPES).join(','),
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

/** Exchange a TikTok authorization code (+ PKCE verifier) for an access token. */
export async function exchangeTikTokCode(
  fetchFn: typeof fetch,
  opts: { clientKey: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string },
): Promise<OAuthTokenResult> {
  const body = new URLSearchParams({
    client_key: opts.clientKey,
    client_secret: opts.clientSecret,
    code: opts.code,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetchFn('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    open_id?: string;
  };
  if (!data.access_token) throw new Error('TikTok token exchange returned no access_token');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: data.expires_in ?? null,
    scope: data.scope ?? null,
    externalUserId: data.open_id ?? null,
    raw: data,
  };
}

/** Query metrics for TikTok videos owned by the authorized creator. */
export async function fetchTikTokVideoMetrics(
  fetchFn: typeof fetch,
  opts: { accessToken: string; videoIds: string[] },
): Promise<Record<string, { likes: number | null; comments: number | null; shares: number | null; views: number | null }>> {
  const res = await fetchFn(
    'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filters: { video_ids: opts.videoIds } }),
    },
  );
  if (!res.ok) throw new Error(`TikTok video query failed: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { videos?: Array<Record<string, number | string>> } };
  const out: Record<string, { likes: number | null; comments: number | null; shares: number | null; views: number | null }> = {};
  for (const vid of data.data?.videos ?? []) {
    const id = String(vid.id);
    out[id] = {
      likes: typeof vid.like_count === 'number' ? vid.like_count : null,
      comments: typeof vid.comment_count === 'number' ? vid.comment_count : null,
      shares: typeof vid.share_count === 'number' ? vid.share_count : null,
      views: typeof vid.view_count === 'number' ? vid.view_count : null,
    };
  }
  return out;
}
