// @influenceos/shared — cross-cutting utilities safe for every layer AND every
// client (server API, worker, web, future mobile). It contains NO Prisma
// import and NO framework code: client-safe enums, the social provider
// architecture (url/embed/capability matrix/adapters), pure metric
// calculations and formatting helpers.

export * from './constants/platforms';
export * from './constants/enums';
export * from './utils/format';
export * from './utils/slug';
export * from './utils/worker-health';
export * from './utils/usage-right';
export * from './utils/csv';
export * from './utils/search-rank';
export * from './utils/load-fixtures';
export * as providers from './providers';
export * as metrics from './metrics';

// Frequently-used provider helpers re-exported at top level for convenience.
export {
  detectPlatform,
  normalizeProfileInput,
  normalizeContentUrl,
  parseContentId,
  buildEmbed,
  isAllowedIframeOrigin,
  IFRAME_ALLOWED_ORIGINS,
  SCRIPT_ALLOWED_ORIGINS,
  getAdapter,
  getAdapterForUrl,
  getAllCapabilities,
  resolveCapabilities,
  CAPABILITY_MATRIX,
  instagramAuthorizeUrl,
  exchangeInstagramCode,
  fetchInstagramMediaMetrics,
  tiktokAuthorizeUrl,
  exchangeTikTokCode,
  fetchTikTokVideoMetrics,
  INSTAGRAM_DEFAULT_SCOPES,
  TIKTOK_DEFAULT_SCOPES,
} from './providers';

export type {
  SocialPlatformAdapter,
  AdapterCapabilities,
  AdapterContext,
  AdapterResult,
  CapabilityLevel,
  EmbedDescriptor,
  ResolvedProfile,
  AvailabilityResult,
  AvailabilityStatus,
  ContentMetricsResult,
  OAuthTokenResult,
} from './providers';
