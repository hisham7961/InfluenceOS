import type { Platform } from '../constants/platforms';

/**
 * Resolve a PUBLIC cover/thumbnail image for a piece of content — WITHOUT any
 * API credentials — so a video shows its real cover instead of a blank
 * placeholder. Only the cover image is publicly reachable this way; the numbers
 * (likes/comments/views) are NOT exposed to third parties without the official
 * API, so this never attempts to read them.
 *
 * Resolution order (each network step time-boxed and guarded):
 *   1. YouTube — derived from the video id (no network).
 *   2. Public oEmbed `thumbnail_url` (TikTok has one).
 *   3. `og:image` / `twitter:image` of the post page (best-effort; many posts
 *      expose one — Instagram increasingly needs a token, so it may return null).
 * Returns null when nothing is found; the caller keeps the placeholder and can
 * retry on the next monitoring refresh.
 */

type FetchFn = typeof fetch;

/** Public oEmbed endpoints (prefix) that return a `thumbnail_url`. */
const OEMBED_THUMBNAIL_ENDPOINT: Partial<Record<Platform, string>> = {
  TIKTOK: 'https://www.tiktok.com/oembed?url=',
};

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v);
}

async function timedFetch(
  url: string,
  fetchFn: FetchFn,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ac.signal, redirect: 'follow' });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first og:image / twitter:image URL from an HTML document. */
export function parseOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && isHttpUrl(m[1])) return m[1].replace(/&amp;/g, '&');
  }
  return null;
}

/**
 * True when a fetch that started at `requestedUrl` ended up somewhere that
 * is clearly not the profile page itself (a login/auth wall, most often —
 * Instagram in particular redirects unauthenticated/bot-flagged requests to
 * `/accounts/login/?next=...`) rather than a real 404 or the profile page.
 * Those interstitial pages have their own generic, platform-branded
 * `og:image` (e.g. Instagram's logo) which would otherwise be silently
 * parsed and stored as if it were the creator's real photo. Checked by path
 * prefix rather than a per-platform login-URL allowlist so it also catches
 * other platforms' equivalent interstitials (checkpoints, consent walls).
 */
function landedOnDifferentPage(requestedUrl: string, finalUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    if (final.hostname !== requested.hostname) return true;
    const reqPath = requested.pathname.replace(/\/+$/, '');
    const finalPath = final.pathname.replace(/\/+$/, '');
    return finalPath !== reqPath;
  } catch {
    return true;
  }
}

/**
 * Resolve a public profile picture (avatar) for an influencer from their
 * profile URL — WITHOUT any API credentials — via the page's og:image /
 * twitter:image (which, on a profile page, is the avatar/header). Best-effort
 * and time-boxed; returns null when the platform requires a login/token
 * (Instagram often does) so the caller keeps the initials placeholder. Only the
 * public picture is read; no private data is scraped.
 */
export async function resolveProfileAvatar(
  profileUrl: string,
  fetchFn?: FetchFn,
  timeoutMs = 4000,
): Promise<string | null> {
  const fn = fetchFn ?? (globalThis.fetch as FetchFn);
  if (!isHttpUrl(profileUrl) || typeof fn !== 'function') return null;
  const page = await timedFetch(profileUrl, fn, timeoutMs, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; InfluenceOSBot/1.0)' },
  });
  if (page?.ok) {
    // A redirect that landed off the requested profile page (typically an
    // auth wall) never carries the real photo — its own og:image would be a
    // generic platform logo, worse than reporting "not found".
    if (landedOnDifferentPage(profileUrl, page.url)) return null;
    try {
      const html = await page.text();
      return parseOgImage(html.slice(0, 200_000));
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function resolveContentThumbnail(opts: {
  platform: Platform;
  canonicalUrl: string;
  externalId?: string | null;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): Promise<string | null> {
  const { platform, canonicalUrl } = opts;
  const externalId = opts.externalId ?? null;
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as FetchFn);
  const timeoutMs = opts.timeoutMs ?? 4000;
  if (!isHttpUrl(canonicalUrl) || typeof fetchFn !== 'function') return null;

  // 1) YouTube — derive from the video id (no network).
  if (platform === 'YOUTUBE' && externalId) {
    return `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`;
  }

  // 2) Public oEmbed thumbnail (TikTok).
  const oembed = OEMBED_THUMBNAIL_ENDPOINT[platform];
  if (oembed) {
    const res = await timedFetch(`${oembed}${encodeURIComponent(canonicalUrl)}`, fetchFn, timeoutMs);
    if (res?.ok) {
      try {
        const json = (await res.json()) as { thumbnail_url?: unknown };
        if (isHttpUrl(json.thumbnail_url)) return json.thumbnail_url;
      } catch {
        /* not JSON */
      }
    }
  }

  // 3) og:image of the post page (best-effort). `canonicalUrl` is already a
  //    validated known-platform URL, so this fetch is bounded to those hosts.
  const page = await timedFetch(canonicalUrl, fetchFn, timeoutMs, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; InfluenceOSBot/1.0)' },
  });
  if (page?.ok) {
    try {
      const html = await page.text();
      const og = parseOgImage(html.slice(0, 200_000));
      if (og) return og;
    } catch {
      /* ignore */
    }
  }

  return null;
}
