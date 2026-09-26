import 'server-only';
import { headers } from 'next/headers';
import { createClient } from '@influenceos/api-client';
import { apiBaseUrl, getAccessToken } from './session';

/**
 * Server-side API client for React Server Components. Reads the httpOnly access
 * token cookie and calls the API directly (server → server, no browser cookie).
 * The middleware keeps the access token fresh, so this is normally valid.
 */
export function getServerApi() {
  return createClient({
    baseUrl: apiBaseUrl(),
    credentials: 'omit',
    token: async () => getAccessToken(),
  });
}

/** A tokenless client (for the login flow, which has no token yet). */
export function getAnonApi() {
  return createClient({ baseUrl: apiBaseUrl(), credentials: 'omit' });
}

/**
 * A tokenless client for public pages (shared report links). Passes on who
 * is asking (address, browser) so the API's rate limit and "was this a
 * person or a link preview" check see the visitor, not the web server.
 */
export async function getPublicApi() {
  const incoming = await headers();
  const relay: Record<string, string> = {};
  for (const h of ['x-forwarded-for', 'x-real-ip', 'x-request-id', 'user-agent']) {
    const v = incoming.get(h);
    if (v) relay[h] = v;
  }
  return createClient({ baseUrl: apiBaseUrl(), credentials: 'omit', headers: relay });
}
