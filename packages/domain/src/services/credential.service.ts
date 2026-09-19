import type { ProviderCredentialStatusDTO } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAdmin } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { seal } from '../lib/crypto';
import {
  CREDENTIAL_KEY_PLATFORM,
  PROVIDER_CREDENTIAL_KEYS,
  isProviderCredentialKey,
  providerCredentialOverrides,
  refreshProviderCredentialOverrides,
} from '../lib/credential-store';

/** Show only the last 4 chars of a secret (admin-facing confirmation, not the value). */
function last4(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/**
 * INT-4 — admin management of provider API credentials. Values are sealed
 * (AES-256-GCM) before they touch the database and are never returned in full;
 * a stored value overrides the same-named env var at runtime. Admin-only.
 */
export function makeCredentialService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Per-key status: where the effective value comes from, masked. Never the value. */
  async function statuses(): Promise<ProviderCredentialStatusDTO[]> {
    requireAdmin(ctx);
    const rows = await prisma.providerCredential.findMany({ select: { key: true, updatedAt: true } });
    const updatedByKey = new Map(rows.map((r) => [r.key, r.updatedAt]));
    const overrides = providerCredentialOverrides();

    return PROVIDER_CREDENTIAL_KEYS.map((key): ProviderCredentialStatusDTO => {
      const stored = overrides[key];
      const envVal = process.env[key];
      let source: 'DB' | 'ENV' | 'NONE' = 'NONE';
      let value: string | undefined;
      if (stored && stored.length > 0) {
        source = 'DB';
        value = stored;
      } else if (envVal && envVal.length > 0) {
        source = 'ENV';
        value = envVal;
      }
      return {
        key,
        platform: CREDENTIAL_KEY_PLATFORM[key],
        source,
        isSet: source !== 'NONE',
        last4: value ? last4(value) : null,
        updatedAt: source === 'DB' ? (updatedByKey.get(key)?.toISOString() ?? null) : null,
      };
    });
  }

  async function set(key: string, value: string): Promise<ProviderCredentialStatusDTO[]> {
    const actor = requireAdmin(ctx);
    if (!isProviderCredentialKey(key)) throw AppError.badRequest(`Unknown provider credential: ${key}`);
    const trimmed = value.trim();
    if (!trimmed) throw AppError.badRequest('Value must not be empty.');
    // Seal before it touches the DB so a raw dump never yields a usable key.
    const sealed = seal(trimmed);
    await prisma.providerCredential.upsert({
      where: { key },
      update: { sealed, updatedById: actor.id },
      create: { key, sealed, updatedById: actor.id },
    });
    await refreshProviderCredentialOverrides(prisma);
    await logActivity(ctx, { type: 'GENERIC', message: `${actor.name} set the ${key} provider credential.` });
    return statuses();
  }

  async function remove(key: string): Promise<ProviderCredentialStatusDTO[]> {
    const actor = requireAdmin(ctx);
    if (!isProviderCredentialKey(key)) throw AppError.badRequest(`Unknown provider credential: ${key}`);
    await prisma.providerCredential.deleteMany({ where: { key } });
    await refreshProviderCredentialOverrides(prisma);
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} removed the ${key} provider credential (reverts to environment).`,
    });
    return statuses();
  }

  return { statuses, set, remove };
}

export type CredentialService = ReturnType<typeof makeCredentialService>;
