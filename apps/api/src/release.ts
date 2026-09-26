/**
 * Release identity, surfaced on /health and Platform status so an operator can
 * tell exactly which build is running. These are injected at deploy time
 * (GIT_SHA, BUILD_TIME) and are NEVER secrets.
 */
import { buildIdentity } from '@influenceos/shared';

export interface ReleaseInfo {
  service: string;
  version: string;
  gitSha: string;
  buildTime: string | null;
  environment: string;
}

export function releaseInfo(service = 'influenceos-api'): ReleaseInfo {
  return {
    service,
    version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
    ...buildIdentity(),
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
  };
}
