import { NextResponse, type NextRequest } from 'next/server';

const ACCESS = 'io_at';
const REFRESH = 'io_rt';
const ACCESS_MAX_AGE = 60 * 15;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

function apiBase(): string {
  return process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
}

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
};

async function refresh(refreshToken: string): Promise<{ access: string; refresh: string } | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tokens?: { accessToken: string; refreshToken: string } };
    if (!data.tokens) return null;
    return { access: data.tokens.accessToken, refresh: data.tokens.refreshToken };
  } catch {
    return null;
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
    const tokens = await refresh(refreshToken);
    if (!tokens) {
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
