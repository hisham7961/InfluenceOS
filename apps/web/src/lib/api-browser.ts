'use client';
import { createClient } from '@influenceos/api-client';

/**
 * Browser API client used by client components / TanStack Query. It talks to
 * the same-origin BFF proxy (/api/bff/*), which injects the httpOnly bearer
 * token and transparently refreshes it. Tokens are never exposed to JS.
 */
export const api = createClient({
  baseUrl: '/api/bff',
  credentials: 'include',
});
