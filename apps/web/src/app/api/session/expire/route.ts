import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { clearAuthCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * A Route Handler (unlike a Server Component, it's allowed to write cookies)
 * that (app)/layout.tsx redirects to when session validation fails, instead
 * of redirecting straight to /login. Without this, the stale access-token
 * cookie survives the redirect: middleware's "already have an access cookie
 * while on /login -> bounce to /" rule immediately sends the browser back to
 * /, the layout's check fails again, and the two bounce forever — a real
 * infinite redirect loop (net::ERR_TOO_MANY_REDIRECTS), not a theoretical
 * one; reproduced via CI's smoke.spec.ts calendar test after a transient
 * auth/brands fetch failure. Clearing the cookies here breaks the cycle:
 * the next hit to /login has no access cookie, so middleware renders it
 * normally instead of bouncing.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const store = await cookies();
  clearAuthCookies(store);
  return NextResponse.redirect(new URL('/login', req.url));
}
