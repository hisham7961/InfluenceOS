import { PLATFORMS, type Platform } from '../constants/platforms';
import { detectPlatform } from './url';
import type { AdapterCapabilities, AdapterContext, SocialPlatformAdapter } from './types';
import { InstagramAdapter } from './adapters/instagram';
import { ManualAdapterFallback } from './adapters/manual';
import { SnapchatAdapter } from './adapters/snapchat';
import { TikTokAdapter } from './adapters/tiktok';
import { XAdapter } from './adapters/x';
import { YouTubeAdapter } from './adapters/youtube';

/**
 * Build the adapter for a platform. Credentials are injected (server-side only)
 * so the same registry runs in the API and the worker without duplicating
 * platform logic.
 */
export function getAdapter(platform: Platform, ctx: AdapterContext): SocialPlatformAdapter {
  switch (platform) {
    case 'YOUTUBE':
      return new YouTubeAdapter(ctx);
    case 'X':
      return new XAdapter(ctx);
    case 'INSTAGRAM':
      return new InstagramAdapter(ctx);
    case 'TIKTOK':
      return new TikTokAdapter(ctx);
    case 'SNAPCHAT':
      return new SnapchatAdapter(ctx);
    default:
      return new ManualAdapterFallback(platform, ctx);
  }
}

/** Resolve the correct adapter directly from a pasted profile/content URL. */
export function getAdapterForUrl(
  url: string,
  ctx: AdapterContext,
): SocialPlatformAdapter | null {
  const platform = detectPlatform(url);
  if (!platform) return null;
  return getAdapter(platform, ctx);
}

/** Capability snapshot for every provider (for the Admin Integrations screen). */
export function getAllCapabilities(ctx: AdapterContext): AdapterCapabilities[] {
  return PLATFORMS.map((p) => getAdapter(p, ctx).getCapabilities());
}

export { PLATFORMS };
export type { Platform };
