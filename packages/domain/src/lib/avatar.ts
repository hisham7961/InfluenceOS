import { getAdapter, normalizeProfileInput, resolveProfileAvatar, type Platform } from '@influenceos/shared';

/**
 * Best-effort profile-photo lookup for a platform + username: tries the
 * official adapter first, then falls back to the profile page's public
 * og:image so a creator still gets a real photo when no API key is
 * configured. Never throws — returns null when nothing can be found.
 * Shared by influencer.service.ts (manual "sync photo" + auto-backfill on
 * linking a social account) and social-account.service.ts.
 */
export async function resolveAvatarUrl(
  platform: Platform,
  username: string,
  credentials: Record<string, string | undefined>,
): Promise<string | null> {
  const normalized = normalizeProfileInput(username, platform);
  if (!normalized) return null;

  const adapter = getAdapter(normalized.platform, { credentials });
  const result = await adapter.resolveProfile(normalized);
  if (result.ok) {
    return result.data.avatarUrl ?? (await resolveProfileAvatar(result.data.profileUrl, undefined, 3500).catch(() => null));
  }
  return resolveProfileAvatar(normalized.profileUrl, undefined, 3500).catch(() => null);
}
