/**
 * Canonical platform metadata.
 *
 * The string values here MUST match the `Platform` enum in the Prisma schema
 * exactly (Prisma enums serialize to these literals), which is what lets the
 * service layer pass these values straight through to the database without a
 * mapping table. This module is browser-safe (no Prisma import).
 */

export const PLATFORMS = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'SNAPCHAT', 'X'] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface PlatformMeta {
  id: Platform;
  label: string;
  /** Lowercase key used for icons / css accents. */
  key: string;
  color: string;
  /** Base URL for a public profile, `{username}` is substituted. */
  profileUrlTemplate: string;
  hostnames: string[];
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  INSTAGRAM: {
    id: 'INSTAGRAM',
    label: 'Instagram',
    key: 'instagram',
    color: '#E1306C',
    profileUrlTemplate: 'https://www.instagram.com/{username}',
    hostnames: ['instagram.com', 'www.instagram.com', 'instagr.am'],
  },
  TIKTOK: {
    id: 'TIKTOK',
    label: 'TikTok',
    key: 'tiktok',
    color: '#000000',
    profileUrlTemplate: 'https://www.tiktok.com/@{username}',
    hostnames: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'],
  },
  YOUTUBE: {
    id: 'YOUTUBE',
    label: 'YouTube',
    key: 'youtube',
    color: '#FF0000',
    profileUrlTemplate: 'https://www.youtube.com/@{username}',
    hostnames: ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'],
  },
  SNAPCHAT: {
    id: 'SNAPCHAT',
    label: 'Snapchat',
    key: 'snapchat',
    color: '#FFFC00',
    profileUrlTemplate: 'https://www.snapchat.com/add/{username}',
    hostnames: ['snapchat.com', 'www.snapchat.com', 't.snapchat.com'],
  },
  X: {
    id: 'X',
    label: 'X',
    key: 'x',
    color: '#000000',
    profileUrlTemplate: 'https://x.com/{username}',
    hostnames: ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.twitter.com'],
  },
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_META[platform].label;
}

export function profileUrl(platform: Platform, username: string): string {
  const handle = username.replace(/^@/, '');
  return PLATFORM_META[platform].profileUrlTemplate.replace('{username}', handle);
}
