import 'server-only';
import { cookies } from 'next/headers';
import {
  WEB_ACCESS_COOKIE,
  WEB_ACCESS_MAX_AGE,
  WEB_BRAND_COOKIE,
  WEB_LOCALE_COOKIE,
  WEB_REFRESH_COOKIE,
  WEB_REFRESH_MAX_AGE,
  WEB_THEME_COOKIE,
} from '@influenceos/contracts/transport';

/**
 * Web token transport (BFF). The browser never sees the access/refresh tokens —
 * they live in httpOnly cookies on the Next origin. Server Components read the
 * access token to call the API directly; client components go through the
 * /api/bff proxy which injects the token. A future mobile app skips all of this
 * and calls the API directly with tokens held in the OS keychain.
 *
 * Cookie names/lifetimes come from the shared transport contract
 * (@influenceos/contracts) so the edge middleware and the API cannot drift.
 */

export const ACCESS_COOKIE = WEB_ACCESS_COOKIE;
export const REFRESH_COOKIE = WEB_REFRESH_COOKIE;
export const LOCALE_COOKIE = WEB_LOCALE_COOKIE;
export const THEME_COOKIE = WEB_THEME_COOKIE;
export const BRAND_COOKIE = WEB_BRAND_COOKIE;

export const ACCESS_MAX_AGE = WEB_ACCESS_MAX_AGE; // 15 minutes (refreshed by middleware)
export const REFRESH_MAX_AGE = WEB_REFRESH_MAX_AGE; // 7 days

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
