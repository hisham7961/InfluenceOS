import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, createClient } from '@influenceos/api-client';
import { LOCALE_COOKIE, THEME_COOKIE, apiBaseUrl, writeAuthCookies } from '@/lib/session';

// UI-preference cookies are readable/writable by the client toggles, so unlike
// the token cookies they are not httpOnly. A year keeps the preference sticky.
const PREF_COOKIE = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let payload: { email?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid body' } }, { status: 400 });
  }

  const api = createClient({ baseUrl: apiBaseUrl(), credentials: 'omit' });
  try {
    const result = await api.auth.login({
      email: payload.email ?? '',
      password: payload.password ?? '',
      device: { client: 'WEB', deviceName: req.headers.get('user-agent')?.slice(0, 120) },
    });
    const store = await cookies();
    writeAuthCookies(store, result.tokens.accessToken, result.tokens.refreshToken);
    // Apply the account's saved UI preferences to this device so theme/locale
    // follow the user across browsers and devices (the source of truth is the
    // account; these cookies are the fast local cache the toggles also update).
    store.set(LOCALE_COOKIE, result.user.locale, PREF_COOKIE);
    store.set(THEME_COOKIE, result.user.theme, PREF_COOKIE);
    return NextResponse.json({ user: result.user });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Login failed. Please try again.' } },
      { status: 500 },
    );
  }
}
