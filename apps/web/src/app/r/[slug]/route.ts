import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tracking links (P3.1): `/r/<slug>` counts the visit and sends the visitor
 * on to the brand's page. Public — no sign-in (the middleware lets `/r/`
 * through). The API decides whether the visit counts: people do, link
 * previews and scripts don't, and a HEAD request never does.
 */

function apiBase(): string {
  return process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
}

function page(status: number, en: string, ar: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${en}</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#334155;text-align:center"><div><p style="font-size:18px;margin:0 0 8px">${en}</p><p dir="rtl" lang="ar" style="font-size:18px;margin:0">${ar}</p></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function follow(req: NextRequest, slug: string, preview: boolean): Promise<NextResponse> {
  if (!/^[a-z0-9]{3,40}$/i.test(slug)) return page(404, 'This link doesn’t exist.', 'هذا الرابط غير موجود.');
  const headers: Record<string, string> = {};
  for (const h of ['x-forwarded-for', 'x-real-ip', 'x-request-id', 'user-agent']) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const res = await fetch(`${apiBase()}/api/v1/public/links/${slug}${preview ? '?preview=1' : ''}`, {
      headers,
      cache: 'no-store',
    });
    if (res.ok) {
      const { url } = (await res.json()) as { url?: string };
      if (url && /^https?:\/\//i.test(url)) {
        const out = NextResponse.redirect(url, 302);
        out.headers.set('cache-control', 'no-store');
        return out;
      }
    }
    if (res.status === 404) return page(404, 'This link doesn’t exist.', 'هذا الرابط غير موجود.');
  } catch {
    // fall through
  }
  return page(503, 'This link isn’t available right now. Please try again shortly.', 'الرابط غير متاح الآن. حاول مرة أخرى بعد قليل.');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return follow(req, (await params).slug, false);
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return follow(req, (await params).slug, true);
}
