import type { Platform } from '../constants/platforms';
import type { AdapterCapabilities, CapabilityLevel } from './types';

/**
 * Central provider capability matrix (spec §52), reflecting current official
 * platform documentation and the fact that this product intentionally does NOT
 * ask influencers to authorize their accounts (no creator OAuth). Because of
 * that, several profile-sync capabilities are AUTHORIZATION_DEPENDENT and the
 * product leans on manual fallbacks + official content embeds.
 *
 * `apiConfigured` flips YES_WITH_API capabilities from advertised-but-inactive
 * to active at runtime; the matrix itself is static and honest about ceilings.
 */

interface MatrixEntry {
  profileLookup: CapabilityLevel;
  followerSync: CapabilityLevel;
  contentLookup: CapabilityLevel;
  contentEmbed: CapabilityLevel;
  contentMetrics: CapabilityLevel;
  availabilityMonitoring: CapabilityLevel;
  requiresCreatorAuthorization: boolean;
  requiresAppAuthorization: boolean;
  notes: string;
}

export const CAPABILITY_MATRIX: Record<Platform, MatrixEntry> = {
  YOUTUBE: {
    profileLookup: 'YES_WITH_API',
    followerSync: 'YES_WITH_API',
    contentLookup: 'YES_WITH_API',
    contentEmbed: 'YES',
    contentMetrics: 'YES_WITH_API',
    availabilityMonitoring: 'YES',
    requiresCreatorAuthorization: false,
    requiresAppAuthorization: false,
    notes:
      'YouTube Data API v3 provides public channel & video statistics with an API key. Embeds use the official privacy-enhanced player.',
  },
  X: {
    profileLookup: 'YES_WITH_API',
    followerSync: 'YES_WITH_API',
    contentLookup: 'CONDITIONAL',
    contentEmbed: 'YES',
    contentMetrics: 'CONDITIONAL',
    availabilityMonitoring: 'YES',
    requiresCreatorAuthorization: false,
    requiresAppAuthorization: true,
    notes:
      'X API v2 (bearer token) can read public profile & tweet data subject to plan limits. Public metrics availability depends on the access tier. Embeds use the official tweet iframe.',
  },
  INSTAGRAM: {
    profileLookup: 'CONDITIONAL',
    followerSync: 'CONDITIONAL',
    contentLookup: 'CONDITIONAL',
    contentEmbed: 'YES',
    contentMetrics: 'CONDITIONAL',
    availabilityMonitoring: 'YES',
    requiresCreatorAuthorization: false,
    requiresAppAuthorization: true,
    notes:
      'Instagram Graph API only exposes data for eligible Professional (Business/Creator) accounts connected through Meta. Personal accounts are manual-only. Content uses the official Instagram embed.',
  },
  TIKTOK: {
    profileLookup: 'AUTHORIZATION_DEPENDENT',
    followerSync: 'AUTHORIZATION_DEPENDENT',
    contentLookup: 'AUTHORIZATION_DEPENDENT',
    contentEmbed: 'YES',
    contentMetrics: 'AUTHORIZATION_DEPENDENT',
    availabilityMonitoring: 'YES',
    requiresCreatorAuthorization: true,
    requiresAppAuthorization: true,
    notes:
      'TikTok profile & video statistics require creator OAuth (Login Kit / Display API), which this product does not perform. Public video embedding is supported via the official TikTok embed. Profiles are manual.',
  },
  SNAPCHAT: {
    profileLookup: 'MANUAL',
    followerSync: 'MANUAL',
    contentLookup: 'MANUAL',
    contentEmbed: 'NO',
    contentMetrics: 'MANUAL',
    availabilityMonitoring: 'CONDITIONAL',
    requiresCreatorAuthorization: false,
    requiresAppAuthorization: false,
    notes:
      'Snapchat has no public profile/content API for third-party creator data. The product treats Snapchat as manual/URL-based; availability is a best-effort link check only.',
  },
};

/**
 * Resolve the effective capabilities for a platform, given whether the
 * official API credential is configured. YES_WITH_API stays advertised but the
 * `apiConfigured` flag tells the UI/service whether it is actually usable.
 */
export function resolveCapabilities(
  platform: Platform,
  apiConfigured: boolean,
): AdapterCapabilities {
  const m = CAPABILITY_MATRIX[platform];
  return {
    platform,
    ...m,
    manualFallback: true,
    apiConfigured,
  };
}
