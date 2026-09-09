import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { AppError } from '../errors';

/**
 * Symmetric envelope encryption for short-lived secrets we must persist briefly
 * (e.g. the grace-window refresh token used to make concurrent refresh
 * idempotent — see auth.service.ts). The key is derived from AUTH_SECRET, so a
 * raw database dump alone never yields a usable token; an attacker who already
 * has AUTH_SECRET can mint tokens regardless, so this adds defense-in-depth
 * without changing the trust boundary.
 *
 * Format (base64): [ 12-byte IV | 16-byte GCM tag | ciphertext ].
 */
function key(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new AppError('INTERNAL', 'AUTH_SECRET is not configured.');
  return scryptSync(s, 'influenceos:envelope:v1', 32);
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function open(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
