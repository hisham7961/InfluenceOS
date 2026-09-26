import { NextResponse, type NextRequest } from 'next/server';
import {
  WEB_ACCESS_COOKIE as ACCESS,
  WEB_ACCESS_MAX_AGE as ACCESS_MAX_AGE,
  WEB_REFRESH_COOKIE as REFRESH,
  WEB_REFRESH_MAX_AGE as REFRESH_MAX_AGE,
} from '@influenceos/contracts/transport';
// Cookie names/lifetimes come from the shared transport contract — the edge
// middleware cannot import the `server-only` session module, so this is how it
// stays in lockstep with it instead of hardcoding the names.

function apiBase(): string {
  return process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
}

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
};

type RefreshOutcome =
  | { kind: 'ok'; access: string; refresh: string }
  /** The refresh token is invalid, expired or revoked: sign out. */
  | { kind: 'rejected' }
  /** The API couldn't answer (restarting, 5xx, rate limited): keep the session. */
  | { kind: 'unavailable' };

async function refresh(refreshToken: string, req: NextRequest): Promise<RefreshOutcome> {
  try {
    const relay: Record<string, string> = { 'content-type': 'application/json' };
    for (const h of ['x-forwarded-for', 'x-real-ip', 'x-request-id', 'user-agent']) {
      const v = req.headers.get(h);
      if (v) relay[h] = v;
    }
    const res = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: relay,
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      return res.status === 400 || res.status === 401 || res.status === 403
        ? { kind: 'rejected' }
        : { kind: 'unavailable' };
    }
    const data = (await res.json()) as { tokens?: { accessToken: string; refreshToken: string } };
    if (!data.tokens) return { kind: 'unavailable' };
    return { kind: 'ok', access: data.tokens.accessToken, refresh: data.tokens.refreshToken };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const access = req.cookies.get(ACCESS)?.value;
  const refreshToken = req.cookies.get(REFRESH)?.value;
  const isLogin = pathname === '/login';

  if (!access && !refreshToken) {
    if (isLogin) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!access && refreshToken) {
    const tokens = await refresh(refreshToken, req);
    // The API is briefly unreachable (e.g. mid-deploy): keep both cookies and
    // let the page render its "try again" state instead of signing out.
    if (tokens.kind === 'unavailable') return NextResponse.next();
    if (tokens.kind === 'rejected') {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = `?next=${encodeURIComponent(pathname)}`;
      const res = NextResponse.redirect(url);
      res.cookies.delete(ACCESS);
      res.cookies.delete(REFRESH);
      return res;
    }
    const res = NextResponse.next();
    res.cookies.set(ACCESS, tokens.access, { ...cookieOpts, maxAge: ACCESS_MAX_AGE });
    res.cookies.set(REFRESH, tokens.refresh, { ...cookieOpts, maxAge: REFRESH_MAX_AGE });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
