import type { Platform } from '../constants/platforms';
import type { DataSource } from '../constants/enums';

/**
 * Social platform adapter contract (spec §21).
 *
 * Every platform integration implements this single interface so platform
 * specifics never leak across the codebase. Adapters NEVER fabricate data:
 * when an operation is not supported (missing credential, account not eligible,
 * capability that requires creator OAuth we do not perform), they return an
 * explicit unsupported result carrying a machine-readable `reason` and, where
 * relevant, `fallback: 'MANUAL'`.
 */

/** Graded capability vocabulary (spec §52). */
export type CapabilityLevel =
  | 'YES' // always available
  | 'YES_WITH_API' // available only when the official API credential is configured
  | 'CONDITIONAL' // depends on account type / eligibility
  | 'AUTHORIZATION_DEPENDENT' // requires creator/app OAuth this product intentionally does not do
  | 'MANUAL' // manual fallback only
  | 'NO'; // not available at all

export interface AdapterCapabilities {
  platform: Platform;
  profileLookup: CapabilityLevel;
  followerSync: CapabilityLevel;
  contentLookup: CapabilityLevel;
  contentEmbed: CapabilityLevel;
  contentMetrics: CapabilityLevel;
  availabilityMonitoring: CapabilityLevel;
  requiresCreatorAuthorization: boolean;
  requiresAppAuthorization: boolean;
  /** Whether a manual fallback path always exists (it always should). */
  manualFallback: boolean;
  /** Whether the official API credential is currently configured. */
  apiConfigured: boolean;
  /** Human-readable explanation of the biggest current limitation. */
  notes: string;
}

export type UnsupportedReason =
  | 'NO_CREDENTIAL'
  | 'REQUIRES_CREATOR_AUTHORIZATION'
  | 'REQUIRES_APP_AUTHORIZATION'
  | 'NOT_SUPPORTED_BY_PLATFORM'
  | 'ACCOUNT_NOT_ELIGIBLE'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_INPUT';

export type AdapterResult<T> =
  | { ok: true; data: T; source: DataSource }
  | {
      ok: false;
      reason: UnsupportedReason;
      message: string;
      fallback: 'MANUAL' | null;
      /** Present when the failure is transient and the caller may retry. */
      retryable?: boolean;
    };

/** Normalized profile input (from a pasted username or URL). */
export interface NormalizedProfileInput {
  platform: Platform;
  username: string;
  profileUrl: string;
}

export interface ResolvedProfile {
  platform: Platform;
  username: string;
  profileUrl: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  followers?: number | null;
  following?: number | null;
  postCount?: number | null;
  isVerified?: boolean | null;
  platformUserId?: string | null;
  raw?: unknown;
}

export interface ProfileSyncResult {
  followers?: number | null;
  following?: number | null;
  postCount?: number | null;
  isVerified?: boolean | null;
  avatarUrl?: string | null;
  displayName?: string | null;
  raw?: unknown;
}

export interface NormalizedContentUrl {
  platform: Platform;
  canonicalUrl: string;
  externalId: string | null;
}

/**
 * Embed descriptor. We NEVER store or render raw provider HTML. Instead we
 * describe a strictly-typed embed the trusted renderer knows how to build.
 */
export interface EmbedDescriptor {
  platform: Platform;
  /** How the front-end should render it. */
  kind: 'iframe' | 'blockquote-script' | 'link-only';
  /** For `iframe`: the exact src (origin must be on the allowlist). */
  iframeSrc?: string;
  /** The allowlisted origin this embed loads from. */
  allowedOrigin?: string;
  /** For `blockquote-script` (e.g. Instagram/TikTok/X official embed.js). */
  scriptSrc?: string;
  embedHtmlUrl?: string;
  externalId: string | null;
  canonicalUrl: string;
  aspectRatio?: number;
}

export interface ContentMetricsResult {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  reposts?: number | null;
  favorites?: number | null;
  saves?: number | null;
  raw?: unknown;
}

export type AvailabilityStatus =
  | 'LIVE'
  | 'REMOVED'
  | 'PRIVATE'
  | 'UNAVAILABLE'
  | 'BROKEN_LINK'
  | 'UNKNOWN';

export interface AvailabilityResult {
  status: AvailabilityStatus;
  httpStatus?: number | null;
  checkedVia: 'OFFICIAL_API' | 'OEMBED' | 'HEAD_REQUEST' | 'NONE';
  message?: string;
}

/** Runtime dependencies injected into adapters (keeps them pure/testable). */
export interface AdapterContext {
  /** Provider credentials, only ever populated server-side. */
  credentials: Record<string, string | undefined>;
  /** Injectable fetch (defaults to global fetch) for testing. */
  fetchFn?: typeof fetch;
}

export interface SocialPlatformAdapter {
  readonly platform: Platform;
  getCapabilities(): AdapterCapabilities;

  /** Detect + normalize a pasted username or profile URL. */
  normalizeProfileInput(input: string): NormalizedProfileInput | null;

  /** Attempt to resolve public/official profile data. */
  resolveProfile(input: NormalizedProfileInput): Promise<AdapterResult<ResolvedProfile>>;

  /** Refresh follower/metric data for an existing account. */
  syncProfile(account: {
    username: string;
    profileUrl?: string | null;
    platformUserId?: string | null;
  }): Promise<AdapterResult<ProfileSyncResult>>;

  /** Detect + normalize a pasted content URL. */
  normalizeContentUrl(url: string): NormalizedContentUrl | null;

  /** Extract the external content id from a URL. */
  parseContentId(url: string): string | null;

  /** Produce a safe embed descriptor (never raw HTML). */
  getEmbed(url: string): EmbedDescriptor | null;

  /** Sync content performance metrics where officially available. */
  syncContentMetrics(content: {
    externalId: string | null;
    originalUrl: string;
  }): Promise<AdapterResult<ContentMetricsResult>>;

  /** Check whether content is still available. */
  checkContentAvailability(content: {
    externalId: string | null;
    originalUrl: string;
  }): Promise<AvailabilityResult>;
}
