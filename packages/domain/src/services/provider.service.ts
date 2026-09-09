import {
  getAdapter,
  getAllCapabilities,
  normalizeProfileInput,
  type Platform,
} from '@influenceos/shared';
import type {
  IntegrationCapabilityDTO,
  ResolveProfileResultDTO,
} from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';

/**
 * Thin domain wrapper around the social provider adapters. Centralizes access
 * so the URL/embed/capability logic (in @influenceos/shared) is invoked the
 * same way from the API and the worker. Never fabricates data — on failure it
 * returns a manual-fallback result the caller surfaces to the user.
 */
export function makeProviderService(ctx: DomainContext) {
  const adapterCtx = { credentials: ctx.credentials };

  function capabilities(): IntegrationCapabilityDTO[] {
    return getAllCapabilities(adapterCtx).map((c) => ({
      platform: c.platform,
      profileLookup: c.profileLookup,
      followerSync: c.followerSync,
      contentLookup: c.contentLookup,
      contentEmbed: c.contentEmbed,
      contentMetrics: c.contentMetrics,
      availabilityMonitoring: c.availabilityMonitoring,
      requiresCreatorAuthorization: c.requiresCreatorAuthorization,
      requiresAppAuthorization: c.requiresAppAuthorization,
      manualFallback: c.manualFallback,
      apiConfigured: c.apiConfigured,
      notes: c.notes,
    }));
  }

  /** Detect platform + attempt official resolution; fall back to manual. */
  async function resolve(
    input: string,
    platformHint?: Platform | null,
  ): Promise<ResolveProfileResultDTO> {
    const normalized = normalizeProfileInput(input, platformHint ?? null);
    if (!normalized) {
      throw AppError.badRequest(
        'Could not detect a supported platform. Paste a full profile URL, or pick a platform and enter the username.',
      );
    }
    const adapter = getAdapter(normalized.platform, adapterCtx);
    const result = await adapter.resolveProfile(normalized);

    if (result.ok) {
      const d = result.data;
      return {
        platform: normalized.platform,
        username: d.username,
        profileUrl: d.profileUrl,
        displayName: d.displayName ?? null,
        avatarUrl: d.avatarUrl ?? null,
        bio: d.bio ?? null,
        followers: d.followers ?? null,
        following: d.following ?? null,
        postCount: d.postCount ?? null,
        isVerified: d.isVerified ?? null,
        platformUserId: d.platformUserId ?? null,
        source: 'OFFICIAL_API',
        manual: false,
        message: null,
      };
    }

    // Graceful manual fallback — we still return the normalized identity.
    return {
      platform: normalized.platform,
      username: normalized.username,
      profileUrl: normalized.profileUrl,
      displayName: null,
      avatarUrl: null,
      bio: null,
      followers: null,
      following: null,
      postCount: null,
      isVerified: null,
      platformUserId: null,
      source: 'MANUAL',
      manual: true,
      message: result.message,
    };
  }

  return { capabilities, resolve, adapterCtx };
}

export type ProviderService = ReturnType<typeof makeProviderService>;
