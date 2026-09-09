import { prisma as defaultPrisma, type PrismaClient } from '@influenceos/database';
import type { UserRole } from '@influenceos/contracts';

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

/** Pull the (server-only) social provider credentials out of the environment. */
export function credentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    YOUTUBE_API_KEY: env.YOUTUBE_API_KEY,
    X_API_BEARER_TOKEN: env.X_API_BEARER_TOKEN,
    INSTAGRAM_ACCESS_TOKEN: env.INSTAGRAM_ACCESS_TOKEN,
    INSTAGRAM_BUSINESS_ACCOUNT_ID: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    INSTAGRAM_APP_ID: env.INSTAGRAM_APP_ID,
    INSTAGRAM_APP_SECRET: env.INSTAGRAM_APP_SECRET,
    TIKTOK_CLIENT_KEY: env.TIKTOK_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: env.TIKTOK_CLIENT_SECRET,
    SNAPCHAT_CLIENT_ID: env.SNAPCHAT_CLIENT_ID,
    SNAPCHAT_CLIENT_SECRET: env.SNAPCHAT_CLIENT_SECRET,
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
