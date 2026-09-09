import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, createClient } from '@influenceos/api-client';
import { apiBaseUrl, writeAuthCookies } from '@/lib/session';

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
