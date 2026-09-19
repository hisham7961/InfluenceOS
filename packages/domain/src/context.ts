import { prisma as defaultPrisma, type PrismaClient } from '@influenceos/database';
import type { UserRole } from '@influenceos/contracts';
import { providerCredentialOverrides, type ProviderCredentialKey } from './lib/credential-store';

/** The authenticated actor performing an operation (null for system/worker). */
export interface Actor {
  id: string;
  name: string;
  role: UserRole;
}

/**
 * Everything a domain service needs, injected per-request. Keeping this
 * explicit (rather than reaching for globals) makes services testable and lets
 * the worker construct a system context with no actor.
 */
export interface DomainContext {
  prisma: PrismaClient;
  actor: Actor | null;
  /** Provider credentials (server-only) used to build social adapters. */
  credentials: Record<string, string | undefined>;
  /** Optional request id for tracing / error correlation. */
  requestId?: string;
}

export interface CreateContextOptions {
  prisma?: PrismaClient;
  actor?: Actor | null;
  env?: Record<string, string | undefined>;
  requestId?: string;
}

/**
 * Resolve the (server-only) social provider credentials. A stored, encrypted
 * admin credential (INT-4) overrides the same-named environment variable; when
 * none is stored the value comes straight from the environment — the default.
 */
export function credentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const overrides = providerCredentialOverrides();
  // A non-empty DB override wins; otherwise fall back to the environment.
  const pick = (k: ProviderCredentialKey): string | undefined => {
    const stored = overrides[k];
    return stored && stored.length > 0 ? stored : env[k];
  };
  return {
    YOUTUBE_API_KEY: pick('YOUTUBE_API_KEY'),
    X_API_BEARER_TOKEN: pick('X_API_BEARER_TOKEN'),
    INSTAGRAM_ACCESS_TOKEN: pick('INSTAGRAM_ACCESS_TOKEN'),
    INSTAGRAM_BUSINESS_ACCOUNT_ID: pick('INSTAGRAM_BUSINESS_ACCOUNT_ID'),
    INSTAGRAM_APP_ID: pick('INSTAGRAM_APP_ID'),
    INSTAGRAM_APP_SECRET: pick('INSTAGRAM_APP_SECRET'),
    TIKTOK_CLIENT_KEY: pick('TIKTOK_CLIENT_KEY'),
    TIKTOK_CLIENT_SECRET: pick('TIKTOK_CLIENT_SECRET'),
    SNAPCHAT_CLIENT_ID: pick('SNAPCHAT_CLIENT_ID'),
    SNAPCHAT_CLIENT_SECRET: pick('SNAPCHAT_CLIENT_SECRET'),
  };
}

export function createContext(opts: CreateContextOptions = {}): DomainContext {
  return {
    prisma: opts.prisma ?? defaultPrisma,
    actor: opts.actor ?? null,
    credentials: credentialsFromEnv(opts.env),
    requestId: opts.requestId,
  };
}

/** A system context with no actor (used by the worker / seed). */
export function systemContext(prisma: PrismaClient = defaultPrisma): DomainContext {
  return { prisma, actor: null, credentials: credentialsFromEnv() };
}
