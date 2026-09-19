import type { PrismaClient } from '@influenceos/database';
import type { Platform } from '@influenceos/contracts';
import { open } from './crypto';

/**
 * INT-4 — opt-in encrypted provider-credential store.
 *
 * Provider API keys are read from the environment by default (see
 * credentialsFromEnv). When an admin stores a key from the UI it is sealed
 * (AES-256-GCM, keyed from AUTH_SECRET) into ProviderCredential and, at runtime,
 * OVERRIDES the same-named environment variable. With no rows the product is
 * purely env-driven — the historical default — so this is additive and safe.
 *
 * Resolution reads a sync, in-memory snapshot so the hot per-request path never
 * hits the DB; the snapshot is refreshed at startup and after every write.
 */

/** The provider credential keys the app understands (mirrors credentialsFromEnv). */
export const PROVIDER_CREDENTIAL_KEYS = [
  'YOUTUBE_API_KEY',
  'X_API_BEARER_TOKEN',
  'INSTAGRAM_ACCESS_TOKEN',
  'INSTAGRAM_BUSINESS_ACCOUNT_ID',
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'SNAPCHAT_CLIENT_ID',
  'SNAPCHAT_CLIENT_SECRET',
] as const;

export type ProviderCredentialKey = (typeof PROVIDER_CREDENTIAL_KEYS)[number];

const KEY_SET = new Set<string>(PROVIDER_CREDENTIAL_KEYS);
export function isProviderCredentialKey(key: string): key is ProviderCredentialKey {
  return KEY_SET.has(key);
}

/** Which platform each credential key belongs to (for grouping in the UI). */
export const CREDENTIAL_KEY_PLATFORM: Record<ProviderCredentialKey, Platform> = {
  YOUTUBE_API_KEY: 'YOUTUBE',
  X_API_BEARER_TOKEN: 'X',
  INSTAGRAM_ACCESS_TOKEN: 'INSTAGRAM',
  INSTAGRAM_BUSINESS_ACCOUNT_ID: 'INSTAGRAM',
  INSTAGRAM_APP_ID: 'INSTAGRAM',
  INSTAGRAM_APP_SECRET: 'INSTAGRAM',
  TIKTOK_CLIENT_KEY: 'TIKTOK',
  TIKTOK_CLIENT_SECRET: 'TIKTOK',
  SNAPCHAT_CLIENT_ID: 'SNAPCHAT',
  SNAPCHAT_CLIENT_SECRET: 'SNAPCHAT',
};

let snapshot: Record<string, string> = {};

/** Sync-readable decrypted DB credential overrides (empty until refreshed). */
export function providerCredentialOverrides(): Record<string, string> {
  return snapshot;
}

/**
 * Load + decrypt provider credentials from the DB into the in-memory snapshot.
 * Call at startup and after any credential write. Never throws: a DB or decrypt
 * failure keeps the previous snapshot rather than blanking live credentials.
 */
export async function refreshProviderCredentialOverrides(prisma: PrismaClient): Promise<void> {
  try {
    const rows = await prisma.providerCredential.findMany({ select: { key: true, sealed: true } });
    const next: Record<string, string> = {};
    for (const r of rows) {
      if (!isProviderCredentialKey(r.key)) continue;
      const value = open(r.sealed);
      if (value) next[r.key] = value;
    }
    snapshot = next;
  } catch {
    /* keep the last good snapshot */
  }
}

/** Test-only: clear the snapshot so no override leaks across test files. */
export function __resetProviderCredentialOverrides(): void {
  snapshot = {};
}
