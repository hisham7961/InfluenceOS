// @influenceos/contracts — the API contract authority (addendum §6).
// Backend is the source of truth; web + future mobile clients type against
// these DTOs, enums, error/pagination envelopes and the feature registry.

export * from './enums';
export * from './errors';
export * from './pagination';
export * from './dto';
export * from './client-config';
export * from './registry/features';
export * as requests from './requests';

export const API_VERSION = 'v1' as const;
export const API_PREFIX = '/api/v1' as const;
