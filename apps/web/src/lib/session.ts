import 'server-only';
import { cookies } from 'next/headers';

/**
 * Web token transport (BFF). The browser never sees the access/refresh tokens —
 * they live in httpOnly cookies on the Next origin. Server Components read the
 * access token to call the API directly; client components go through the
 * /api/bff proxy which injects the token. A future mobile app skips all of this
 * and calls the API directly with tokens held in the OS keychain.
 */

export const ACCESS_COOKIE = 'io_at';
export const REFRESH_COOKIE = 'io_rt';
export const LOCALE_COOKIE = 'locale';
export const THEME_COOKIE = 'theme';
export const BRAND_COOKIE = 'io_brand';

export const ACCESS_MAX_AGE = 60 * 15; // 15 minutes (refreshed by middleware)
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function apiBaseUrl(): string {
  return process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
}

export async function getAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return Boolean(store.get(ACCESS_COOKIE)?.value || store.get(REFRESH_COOKIE)?.value);
}

interface CookieWriter {
  set: (name: string, value: string, opts: Record<string, unknown>) => void;
  delete: (name: string) => void;
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
};

export function writeAuthCookies(store: CookieWriter, accessToken: string, refreshToken: string) {
  store.set(ACCESS_COOKIE, accessToken, { ...baseCookie, maxAge: ACCESS_MAX_AGE });
  store.set(REFRESH_COOKIE, refreshToken, { ...baseCookie, maxAge: REFRESH_MAX_AGE });
}

export function clearAuthCookies(store: CookieWriter) {
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}
