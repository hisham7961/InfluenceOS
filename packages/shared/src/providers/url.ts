import { PLATFORM_META, PLATFORMS, profileUrl, type Platform } from '../constants/platforms';
import type { NormalizedContentUrl, NormalizedProfileInput } from './types';

/** Strip protocol/handle noise and return a bare hostname, or null. */
function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProto);
  } catch {
    return null;
  }
}

function hostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** Detect a platform from a URL or a bare `@handle` (best-effort). */
export function detectPlatform(input: string): Platform | null {
  const url = parseUrl(input);
  if (url) {
    const host = url.hostname.toLowerCase();
    for (const platform of PLATFORMS) {
      if (PLATFORM_META[platform].hostnames.some((h) => host === h || host.endsWith(`.${h}`))) {
        return platform;
      }
    }
    return null;
  }
  return null;
}

const HANDLE_RE = /^@?[A-Za-z0-9._-]{1,60}$/;

/**
 * Normalize a pasted profile input (a bare username or a profile URL) into a
 * canonical `{ platform, username, profileUrl }`. Returns null when neither a
 * platform can be detected nor an explicit platform hint is provided.
 */
export function normalizeProfileInput(
  input: string,
  platformHint?: Platform | null,
): NormalizedProfileInput | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare handle (no protocol, no path) plus a platform hint — resolve directly.
  const isExplicitUrl = /^https?:\/\//i.test(raw) || raw.includes('/');
  if (!isExplicitUrl && platformHint && HANDLE_RE.test(raw)) {
    const username = raw.replace(/^@/, '');
    return { platform: platformHint, username, profileUrl: profileUrl(platformHint, username) };
  }

  const url = parseUrl(raw);
  const detected = detectPlatform(raw) ?? platformHint ?? null;

  if (!url || !detected) {
    // Bare handle without hint — cannot know platform.
    return null;
  }

  const path = url.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  let username = '';

  switch (detected) {
    case 'INSTAGRAM':
    case 'SNAPCHAT':
      username = (segments[0] ?? '').replace(/^@/, '');
      if (detected === 'SNAPCHAT' && segments[0] === 'add') username = segments[1] ?? '';
      break;
    case 'TIKTOK': {
      const at = segments.find((s) => s.startsWith('@'));
      username = (at ?? segments[0] ?? '').replace(/^@/, '');
      break;
    }
    case 'YOUTUBE': {
      const first = segments[0] ?? '';
      if (first.startsWith('@')) username = first.slice(1);
      else if (['channel', 'c', 'user'].includes(first)) username = segments[1] ?? '';
      else username = first;
      break;
    }
    case 'X':
      username = (segments[0] ?? '').replace(/^@/, '');
      break;
  }

  username = username.replace(/^@/, '').trim();
  if (!username || !HANDLE_RE.test(username)) return null;

  return { platform: detected, username, profileUrl: profileUrl(detected, username) };
}

/** Extract the external content id from a content URL for a given platform. */
export function parseContentId(url: string, platform?: Platform | null): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const plat = platform ?? detectPlatform(url);
  if (!plat) return null;

  const host = hostname(parsed);
  const segments = parsed.pathname.split('/').filter(Boolean);

  switch (plat) {
    case 'YOUTUBE': {
      if (host === 'youtu.be') return segments[0] ?? null;
      const v = parsed.searchParams.get('v');
      if (v) return v;
      // /shorts/<id>, /embed/<id>, /live/<id>
      const idx = segments.findIndex((s) => ['shorts', 'embed', 'live', 'v'].includes(s));
      if (idx >= 0 && segments[idx + 1]) return segments[idx + 1] ?? null;
      return null;
    }
    case 'X': {
      const idx = segments.findIndex((s) => s === 'status' || s === 'statuses');
      if (idx >= 0 && segments[idx + 1]) return (segments[idx + 1] ?? '').split('?')[0] ?? null;
      return null;
    }
    case 'INSTAGRAM': {
      const idx = segments.findIndex((s) => ['p', 'reel', 'reels', 'tv'].includes(s));
      if (idx >= 0 && segments[idx + 1]) return segments[idx + 1] ?? null;
      return null;
    }
    case 'TIKTOK': {
      const idx = segments.findIndex((s) => s === 'video');
      if (idx >= 0 && segments[idx + 1]) return segments[idx + 1] ?? null;
      // Short links (vm.tiktok.com/XXXX) cannot be resolved without a redirect.
      if (host === 'vm.tiktok.com' || host === 'm.tiktok.com') return segments[0] ?? null;
      return null;
    }
    case 'SNAPCHAT': {
      // Snapchat content ids are not reliably encoded in shareable URLs.
      return segments[segments.length - 1] ?? null;
    }
  }
  return null;
}

/** Normalize a content URL to a canonical form + external id. */
export function normalizeContentUrl(url: string): NormalizedContentUrl | null {
  const platform = detectPlatform(url);
  if (!platform) return null;
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const externalId = parseContentId(url, platform);

  // YouTube carries the video id in the `v` query param, so stripping the query
  // would erase the content identity. Rebuild a canonical watch URL from the id.
  if (platform === 'YOUTUBE' && externalId) {
    return { platform, canonicalUrl: `https://www.youtube.com/watch?v=${externalId}`, externalId };
  }

  // Every other supported platform carries the id in the path; strip tracking
  // query params but keep the essential path.
  parsed.search = '';
  parsed.hash = '';
  const canonicalUrl = parsed.toString().replace(/\/+$/, '');
  return { platform, canonicalUrl, externalId };
}

/**
 * The post id when it reliably names one post on its platform, so the same
 * post reached through a different link (x.com vs twitter.com, an Instagram
 * link with the username in it) is still recognised. Null when the id can't
 * be trusted — Snapchat links and unresolved share links.
 */
export function stablePostId(platform: Platform, externalId: string | null): string | null {
  if (!externalId) return null;
  switch (platform) {
    case 'TIKTOK':
      return /^\d{8,}$/.test(externalId) ? externalId : null;
    case 'X':
      return /^\d{5,}$/.test(externalId) ? externalId : null;
    case 'INSTAGRAM':
      return /^[A-Za-z0-9_-]{5,}$/.test(externalId) ? externalId : null;
    case 'YOUTUBE':
      return /^[A-Za-z0-9_-]{11}$/.test(externalId) ? externalId : null;
    default:
      return null;
  }
}

const RESERVED_INSTAGRAM = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'share', 'explore']);
const RESERVED_X = new Set(['i', 'intent', 'home', 'search', 'hashtag']);

/**
 * The creator's handle when a post link carries one: tiktok.com/@name/video/…,
 * snapchat.com/@name/…, x.com/name/status/…, instagram.com/name/reel/… and
 * instagram.com/stories/name/…. Null when the link doesn't name the account
 * (most Instagram and YouTube links).
 */
export function contentUrlHandle(url: string): string | null {
  const parsed = parseUrl(url);
  const platform = detectPlatform(url);
  if (!parsed || !platform) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  let handle: string | null = null;
  switch (platform) {
    case 'TIKTOK':
    case 'SNAPCHAT':
    case 'YOUTUBE': {
      const at = segments.find((s) => s.startsWith('@'));
      handle = at ? at.slice(1) : null;
      if (!handle && platform === 'SNAPCHAT' && segments[0] === 'add') handle = segments[1] ?? null;
      break;
    }
    case 'X':
      if (segments[1] === 'status' && segments[0] && !RESERVED_X.has(segments[0].toLowerCase())) handle = segments[0];
      break;
    case 'INSTAGRAM':
      if (segments[0] === 'stories' && segments[1]) handle = segments[1];
      else if (segments[0] && !RESERVED_INSTAGRAM.has(segments[0].toLowerCase()) && ['p', 'reel', 'reels', 'tv'].includes(segments[1] ?? ''))
        handle = segments[0];
      break;
  }
  if (!handle) return null;
  try {
    handle = decodeURIComponent(handle).replace(/^@/, '');
  } catch {
    return null;
  }
  return HANDLE_RE.test(handle) ? handle : null;
}
