/**
 * Map a server-issued storage URL to a URL the browser can reach.
 *
 * The API returns either an absolute presigned URL (S3 — used verbatim) or a
 * relative `/api/v1/...` path for the local-driver proxy. The browser can't
 * hit the API origin directly (tokens live in httpOnly cookies), so relative
 * paths are routed through the same-origin BFF at `/api/bff/api/v1/...`.
 * A plain module (no 'use client'), so server components can use it too.
 */
export function toBrowserUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `/api/bff${url.startsWith('/') ? '' : '/'}${url}`;
}
