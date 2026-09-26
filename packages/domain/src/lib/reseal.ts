import type { PrismaClient } from '@influenceos/database';
import { isSealedWithCurrentKey, open, seal } from './crypto';

export interface ResealResult {
  /** Sealed values looked at. */
  checked: number;
  /** Values rewritten under the current key. */
  resealed: number;
  /** Values no configured key could open (left untouched). */
  unreadable: number;
}

/**
 * Rewrite every stored secret under the current encryption key — run once
 * after setting ENCRYPTION_KEY (see lib/crypto.ts). Values already under the
 * current key are skipped, so it is safe to run again. Nothing is deleted:
 * a value that no key opens is counted and left as it is.
 */
export async function resealStoredSecrets(prisma: PrismaClient): Promise<ResealResult> {
  const result: ResealResult = { checked: 0, resealed: 0, unreadable: 0 };

  /** The new sealed value, or undefined when it needs no change / can't be read. */
  const reseal = (sealed: string | null): string | undefined => {
    if (!sealed) return undefined;
    result.checked++;
    if (isSealedWithCurrentKey(sealed)) return undefined;
    const plain = open(sealed);
    if (plain === null) {
      result.unreadable++;
      return undefined;
    }
    result.resealed++;
    return seal(plain);
  };

  for (const row of await prisma.providerCredential.findMany({ select: { id: true, sealed: true } })) {
    const sealed = reseal(row.sealed);
    if (sealed) await prisma.providerCredential.update({ where: { id: row.id }, data: { sealed } });
  }

  const tokens = await prisma.creatorOAuthToken.findMany({
    select: { id: true, sealedAccessToken: true, sealedRefreshToken: true },
  });
  for (const row of tokens) {
    const access = reseal(row.sealedAccessToken);
    const refresh = reseal(row.sealedRefreshToken);
    if (access || refresh) {
      await prisma.creatorOAuthToken.update({
        where: { id: row.id },
        data: { ...(access ? { sealedAccessToken: access } : {}), ...(refresh ? { sealedRefreshToken: refresh } : {}) },
      });
    }
  }

  // Grace-window refresh tokens live for seconds; re-seal the few that exist.
  const sessions = await prisma.deviceSession.findMany({
    where: { graceTokenSealed: { not: null } },
    select: { id: true, graceTokenSealed: true },
  });
  for (const row of sessions) {
    const sealed = reseal(row.graceTokenSealed);
    if (sealed) await prisma.deviceSession.update({ where: { id: row.id }, data: { graceTokenSealed: sealed } });
  }

  return result;
}
