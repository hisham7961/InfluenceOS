import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  apiBaseUrl,
  clearAuthCookies,
  writeAuthCookies,
} from '@/lib/session';

/**
 * Thin transport proxy — NO business logic. Forwards client-side requests to
 * the platform API, injecting the httpOnly access token and transparently
 * refreshing it on 401. This keeps tokens out of JS while the web behaves as a
 * pure API client (the same API a mobile app will call directly).
 */
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function tryRefresh(store: Awaited<ReturnType<typeof cookies>>): Promise<string | null> {
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearAuthCookies(store);
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

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const store = await cookies();
  const target = `${apiBaseUrl()}/${path.join('/')}${req.nextUrl.search}`;
  const method = req.method;
  // Forward the body as raw bytes so binary uploads (octet-stream) pass through
  // intact; JSON bodies survive equally as their UTF-8 byte representation.
  const rawBody =
    method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer());

  const fwd = (token: string | undefined) => {
    const headers: Record<string, string> = { accept: 'application/json' };
    const ct = req.headers.get('content-type');
    if (ct) headers['content-type'] = ct;
    if (token) headers.authorization = `Bearer ${token}`;
    return fetch(target, { method, headers, body: rawBody, redirect: 'manual' });
  };

  let res = await fwd(store.get(ACCESS_COOKIE)?.value);
  if (res.status === 401) {
    const refreshed = await tryRefresh(store);
    if (refreshed) res = await fwd(refreshed);
  }

  const buf = await res.arrayBuffer();
  const out = new NextResponse(buf, { status: res.status });
  const ct = res.headers.get('content-type');
  if (ct) out.headers.set('content-type', ct);
  const cd = res.headers.get('content-disposition');
  if (cd) out.headers.set('content-disposition', cd);
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
