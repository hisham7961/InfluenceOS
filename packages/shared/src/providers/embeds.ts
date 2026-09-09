import type { Platform } from '../constants/platforms';
import type { EmbedDescriptor } from './types';
import { detectPlatform, normalizeContentUrl, parseContentId } from './url';

/**
 * Strict iframe origin allowlist (spec §38). ONLY these origins are ever
 * allowed as an embed iframe `src`, and these are the only entries that belong
 * in the `frame-src` CSP directive. We never render provider-supplied HTML.
 */
export const IFRAME_ALLOWED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://www.instagram.com',
  'https://www.tiktok.com',
  'https://platform.twitter.com',
] as const;

/** Origins allowed to serve official embed scripts (blockquote embeds). */
export const SCRIPT_ALLOWED_ORIGINS = [
  'https://www.instagram.com',
  'https://platform.twitter.com',
  'https://www.tiktok.com',
] as const;

export function isAllowedIframeOrigin(src: string): boolean {
  try {
    const origin = new URL(src).origin;
    return (IFRAME_ALLOWED_ORIGINS as readonly string[]).includes(origin);
  } catch {
    return false;
  }
}

/**
 * Build a safe, strongly-typed embed descriptor from a content URL.
 * Returns null when the platform is unknown or the id cannot be extracted.
 * Snapchat (and any unembeddable content) returns a `link-only` descriptor.
 */
export function buildEmbed(url: string, platformHint?: Platform | null): EmbedDescriptor | null {
  const platform = platformHint ?? detectPlatform(url);
  if (!platform) return null;
  const normalized = normalizeContentUrl(url);
  const canonicalUrl = normalized?.canonicalUrl ?? url;
  const externalId = parseContentId(url, platform);

  switch (platform) {
    case 'YOUTUBE': {
      if (!externalId) return linkOnly(platform, externalId, canonicalUrl);
      const iframeSrc = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(externalId)}?rel=0`;
      return {
        platform,
        kind: 'iframe',
        iframeSrc,
        allowedOrigin: 'https://www.youtube-nocookie.com',
        externalId,
        canonicalUrl,
        aspectRatio: 16 / 9,
      };
    }
    case 'INSTAGRAM': {
      if (!externalId) return linkOnly(platform, externalId, canonicalUrl);
      const kind = /\/reel/i.test(url) ? 'reel' : /\/tv/i.test(url) ? 'tv' : 'p';
      const iframeSrc = `https://www.instagram.com/${kind}/${encodeURIComponent(externalId)}/embed`;
      return {
        platform,
        kind: 'iframe',
        iframeSrc,
        allowedOrigin: 'https://www.instagram.com',
        externalId,
        canonicalUrl,
        aspectRatio: 4 / 5,
      };
    }
    case 'TIKTOK': {
      if (!externalId || !/^\d+$/.test(externalId)) {
        // Short links / unresolvable ids fall back to a link.
        return linkOnly(platform, externalId, canonicalUrl);
      }
      const iframeSrc = `https://www.tiktok.com/embed/v2/${encodeURIComponent(externalId)}`;
      return {
        platform,
        kind: 'iframe',
        iframeSrc,
        allowedOrigin: 'https://www.tiktok.com',
        externalId,
        canonicalUrl,
        aspectRatio: 9 / 16,
      };
    }
    case 'X': {
      if (!externalId) return linkOnly(platform, externalId, canonicalUrl);
      const iframeSrc = `https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(externalId)}`;
      return {
        platform,
        kind: 'iframe',
        iframeSrc,
        allowedOrigin: 'https://platform.twitter.com',
        externalId,
        canonicalUrl,
        aspectRatio: 16 / 10,
      };
    }
    case 'SNAPCHAT':
    default:
      return linkOnly(platform, externalId, canonicalUrl);
  }
}

function linkOnly(
  platform: Platform,
  externalId: string | null,
  canonicalUrl: string,
): EmbedDescriptor {
  return { platform, kind: 'link-only', externalId, canonicalUrl };
}
