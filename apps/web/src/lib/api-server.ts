import 'server-only';
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
