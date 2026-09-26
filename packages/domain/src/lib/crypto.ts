import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { AppError } from '../errors';

/**
 * Symmetric envelope encryption for secrets we must persist: provider API
 * keys entered in Admin → Integrations, creators' OAuth tokens, and the
 * grace-window refresh token used to make concurrent refresh idempotent (see
 * auth.service.ts). A raw database dump alone never yields a usable secret.
 *
 * The key comes from ENCRYPTION_KEY when it is set, so the secret that signs
 * sessions (AUTH_SECRET) and the one that protects stored credentials can be
 * rotated separately. Without ENCRYPTION_KEY it is derived from AUTH_SECRET,
 * as before. Values sealed under the AUTH_SECRET key still open after
 * ENCRYPTION_KEY is introduced; `pnpm --filter @influenceos/database run
 * reseal` rewrites them under the new key.
 *
 * Format (base64): [ 12-byte IV | 16-byte GCM tag | ciphertext ].
 */
function derive(secret: string): Buffer {
  return scryptSync(secret, 'influenceos:envelope:v1', 32);
}

const cache = new Map<string, Buffer>();
function keyFrom(secret: string): Buffer {
  let k = cache.get(secret);
  if (!k) {
    k = derive(secret);
    cache.set(secret, k);
  }
  return k;
}

function authSecret(): string | undefined {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 16 ? s : undefined;
}

function encryptionSecret(): string | undefined {
  const s = process.env.ENCRYPTION_KEY;
  return s && s.length >= 32 ? s : undefined;
}

/** The key new values are sealed with. */
function currentKey(): Buffer {
  const s = encryptionSecret() ?? authSecret();
  if (!s) throw new AppError('INTERNAL', 'ENCRYPTION_KEY / AUTH_SECRET is not configured.');
  return keyFrom(s);
}

/** Every key a stored value may have been sealed with, current first. */
function candidateKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const enc = encryptionSecret();
  const auth = authSecret();
  if (enc) keys.push(keyFrom(enc));
  if (auth && auth !== enc) keys.push(keyFrom(auth));
  if (keys.length === 0) throw new AppError('INTERNAL', 'ENCRYPTION_KEY / AUTH_SECRET is not configured.');
  return keys;
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', currentKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function openWith(key: Buffer, raw: Buffer): string | null {
  try {
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function open(sealed: string): string | null {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 28) return null;
  let keys: Buffer[];
  try {
    keys = candidateKeys();
  } catch {
    return null;
  }
  for (const key of keys) {
    const value = openWith(key, raw);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Whether a sealed value is already under the current key (so a re-seal
 * pass can skip it). False when it only opens with an older key.
 */
export function isSealedWithCurrentKey(sealed: string): boolean {
  const raw = Buffer.from(sealed, 'base64');
  return raw.length >= 28 && openWith(currentKey(), raw) !== null;
}
