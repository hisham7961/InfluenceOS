import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  apiBaseUrl,
  clearAuthCookies,
  writeAuthCookies,
} from '@/lib/session';
import { forwardedHeaders, refreshWasRejected } from '@/lib/forwarded';

/**
 * Thin transport proxy — NO business logic. Forwards client-side requests to
 * the platform API, injecting the httpOnly access token and transparently
 * refreshing it on 401. This keeps tokens out of JS while the web behaves as a
 * pure API client (the same API a mobile app will call directly).
 */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function tryRefresh(
  store: Awaited<ReturnType<typeof cookies>>,
  relay: Record<string, string>,
): Promise<string | null> {
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { ...relay, 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      // Only a rejected token ends the session. A restarting API (deploy),
      // a 5xx or a 429 must not sign the whole team out.
      if (refreshWasRejected(res.status)) clearAuthCookies(store);
      return null;
    }
    const data = (await res.json()) as { tokens?: { accessToken: string; refreshToken: string } };
    if (!data.tokens) return null;
    writeAuthCookies(store, data.tokens.accessToken, data.tokens.refreshToken);
    return data.tokens.accessToken;
  } catch {
    return null;
  }
}

/**
 * Only the versioned API goes through the proxy — never /metrics, /health or
 * anything else the API serves on its private network — and no segment may
 * step out of it (`..`, `.`, or an encoded slash).
 */
function isApiPath(path: string[]): boolean {
  return (
    path[0] === 'api' &&
    path[1] === 'v1' &&
    path.every((seg) => seg !== '' && seg !== '.' && seg !== '..' && !/[/\\]/.test(seg))
  );
}

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  if (!isApiPath(path)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
  }
  const store = await cookies();
  const target = `${apiBaseUrl()}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const method = req.method;
  // Forward the body as raw bytes so binary uploads (octet-stream) pass through
  // intact; JSON bodies survive equally as their UTF-8 byte representation.
  const rawBody =
    method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer());

  const relay = forwardedHeaders(req.headers);
  const fwd = (token: string | undefined) => {
    const headers: Record<string, string> = { ...relay, accept: 'application/json' };
    const ct = req.headers.get('content-type');
    if (ct) headers['content-type'] = ct;
    if (token) headers.authorization = `Bearer ${token}`;
    return fetch(target, { method, headers, body: rawBody, redirect: 'manual' });
  };

  let res = await fwd(store.get(ACCESS_COOKIE)?.value);
  if (res.status === 401) {
    const refreshed = await tryRefresh(store, relay);
    if (refreshed) res = await fwd(refreshed);
  }

  const buf = await res.arrayBuffer();
  // 204/205/304 responses MUST have a null body — the Response constructor
  // throws otherwise (e.g. a 204 from delete/upload/logout).
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  const out = new NextResponse(nullBody ? null : buf, { status: res.status });
  const ct = res.headers.get('content-type');
  if (ct && !nullBody) out.headers.set('content-type', ct);
  const cd = res.headers.get('content-disposition');
  if (cd) out.headers.set('content-disposition', cd);
  // Images (saved post covers) keep the API's caching, so a cover isn't
  // downloaded again on every page.
  if (ct?.startsWith('image/')) {
    for (const h of ['cache-control', 'x-content-type-options']) {
      const v = res.headers.get(h);
      if (v) out.headers.set(h, v);
    }
  }
  // Rate-limit and request-id headers let the browser back off and let a
  // support request be matched to the server log.
  for (const h of ['retry-after', 'x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
    const v = res.headers.get(h);
    if (v) out.headers.set(h, v);
  }
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
