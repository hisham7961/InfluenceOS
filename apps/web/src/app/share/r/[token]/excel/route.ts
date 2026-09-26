import { NextResponse, type NextRequest } from 'next/server';

/**
 * The Excel download on a shared report (P3.3). Public like the page: the
 * API checks the link; this only passes the file through.
 */
function apiBase(): string {
  return process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new NextResponse('Not found', { status: 404 });
  const headers: Record<string, string> = {};
  for (const h of ['x-forwarded-for', 'x-real-ip', 'x-request-id', 'user-agent']) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const res = await fetch(`${apiBase()}/api/v1/public/reports/${token}/xlsx`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok || !res.body) {
      return new NextResponse(
        res.status === 404 ? 'This report link no longer works.' : 'Not available right now.',
        {
          status: res.status === 404 ? 404 : 503,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        },
      );
    }
    const out = new NextResponse(res.body, { status: 200 });
    for (const h of ['content-type', 'content-disposition']) {
      const v = res.headers.get(h);
      if (v) out.headers.set(h, v);
    }
    out.headers.set('cache-control', 'private, no-store');
    out.headers.set('referrer-policy', 'no-referrer');
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  } catch {
    return new NextResponse('Not available right now.', {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
