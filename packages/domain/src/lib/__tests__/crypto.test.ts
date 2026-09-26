import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSealedWithCurrentKey, open, seal } from '../crypto';

/**
 * P2.4 — stored secrets can move to their own ENCRYPTION_KEY without losing
 * what was sealed under AUTH_SECRET before.
 */
describe('envelope encryption', () => {
  const saved = { auth: process.env.AUTH_SECRET, enc: process.env.ENCRYPTION_KEY };
  beforeEach(() => {
    process.env.AUTH_SECRET = 'auth-secret-for-tests-0123456789abcdef';
    delete process.env.ENCRYPTION_KEY;
  });
  afterEach(() => {
    process.env.AUTH_SECRET = saved.auth;
    if (saved.enc === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved.enc;
  });

  it('seals and opens with AUTH_SECRET when no ENCRYPTION_KEY is set', () => {
    const s = seal('provider-key');
    expect(open(s)).toBe('provider-key');
    expect(isSealedWithCurrentKey(s)).toBe(true);
  });

  it('keeps opening old values after ENCRYPTION_KEY is added, and seals new ones with it', () => {
    const old = seal('old-token');
    process.env.ENCRYPTION_KEY = 'a-separate-encryption-key-of-32-chars-or-more';
    expect(open(old)).toBe('old-token');
    expect(isSealedWithCurrentKey(old)).toBe(false);

    const fresh = seal('new-token');
    expect(isSealedWithCurrentKey(fresh)).toBe(true);
    // Once AUTH_SECRET is rotated, only ENCRYPTION_KEY values still open.
    process.env.AUTH_SECRET = 'a-rotated-auth-secret-0123456789abcdef';
    expect(open(fresh)).toBe('new-token');
    expect(open(old)).toBeNull();
  });

  it('ignores an ENCRYPTION_KEY shorter than 32 characters', () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    const s = seal('x');
    delete process.env.ENCRYPTION_KEY;
    expect(isSealedWithCurrentKey(s)).toBe(true);
  });

  it('returns null for garbage instead of throwing', () => {
    expect(open('not-base64-sealed')).toBeNull();
    expect(open('')).toBeNull();
  });
});
