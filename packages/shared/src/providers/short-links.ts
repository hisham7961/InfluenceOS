import { normalizeContentUrl } from './url';

type FetchFn = typeof fetch;

/**
 * Share-sheet links that only redirect to the real post: TikTok's
 * vm./vt.tiktok.com and tiktok.com/t/… links, and Instagram's /share/…
 * links. They carry no post id, so they can't be embedded or checked for
 * duplicates until the redirect is followed.
 */
export function isShortContentLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname;
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return true;
  if (host === 'tiktok.com' && /^\/t\/[^/]+/.test(path)) return true;
  if (host === 'instagram.com' && /^\/share\//.test(path)) return true;
  return false;
}

/** Hosts a short link may redirect through or to — never anywhere else. */
function allowedHop(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'tiktok.com' ||
    host.endsWith('.tiktok.com') ||
    host === 'instagram.com' ||
    host.endsWith('.instagram.com')
  );
}

/** A URL that names a specific post (not a share or mobile redirect link). */
function isPostUrl(url: string): boolean {
  return (
    /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/(video|photo)\/\d+$/.test(url) ||
    /^https:\/\/(www\.)?instagram\.com\/([A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/[^/]+$/.test(url)
  );
}

/**
 * Follow a share-sheet short link to the post it points to and return that
 * post's canonical URL, or null when it isn't a short link, the redirect
 * can't be followed, or it leads somewhere that isn't a post. Only TikTok
 * and Instagram hosts are ever contacted, at most `maxHops` times.
 */
export async function resolveShortContentUrl(
  url: string,
  opts: { fetchFn?: FetchFn; timeoutMs?: number; maxHops?: number } = {},
): Promise<string | null> {
  if (!isShortContentLink(url)) return null;
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as FetchFn | undefined);
  if (typeof fetchFn !== 'function') return null;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const maxHops = opts.maxHops ?? 5;

  let current: URL;
  try {
    current = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }

  for (let hop = 0; hop < maxHops; hop++) {
    if (!allowedHop(current)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; InfluenceOS link check)' },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) break;
    try {
      current = new URL(location, current);
    } catch {
      return null;
    }
    // Stop as soon as we reach a URL that names the post.
    const normalized = normalizeContentUrl(current.toString());
    if (normalized && isPostUrl(normalized.canonicalUrl)) return normalized.canonicalUrl;
  }
  return null;
}
