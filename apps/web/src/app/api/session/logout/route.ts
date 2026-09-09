import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@influenceos/api-client';
import { REFRESH_COOKIE, apiBaseUrl, clearAuthCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      const api = createClient({ baseUrl: apiBaseUrl(), credentials: 'omit' });
      await api.auth.logout({ refreshToken });
    } catch {
      /* best effort */
    }
  }
  clearAuthCookies(store);
  return NextResponse.json({ ok: true });
}
