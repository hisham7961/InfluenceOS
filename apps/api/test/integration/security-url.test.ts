import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { requests } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W1-1 / SEC-01 — stored-XSS defence. User-supplied URL fields must reject a
 * dangerous scheme (javascript:/data:/vbscript:/file:) at write time, both at
 * the schema layer (the shared validation authority) and end-to-end through a
 * real route. http(s) and relative values are still accepted.
 */

const DANGEROUS = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)', // leading whitespace
  'java\tscript:alert(1)', // control-char smuggling
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

const SAFE = [
  'https://instagram.com/creator',
  'http://localhost:9000/img.png',
  '/relative/path.png',
  '', // empty is allowed (optional field)
];

describe('SEC-01 — safe display URL guard (schema layer)', () => {
  it('rejects every dangerous scheme on brandCreateSchema.logoUrl', () => {
    for (const v of DANGEROUS) {
      const res = requests.brandCreateSchema.safeParse({ name: 'X', logoUrl: v });
      expect(res.success, `should reject ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('accepts http(s) and relative values on brandCreateSchema.logoUrl', () => {
    for (const v of SAFE) {
      const res = requests.brandCreateSchema.safeParse({ name: 'X', logoUrl: v });
      expect(res.success, `should accept ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it('rejects javascript: on the required published-content url', () => {
    expect(requests.publishedContentCreateSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(requests.publishedContentCreateSchema.safeParse({ url: 'https://x.com/p/1' }).success).toBe(true);
    // z.url() alone would accept a bare "javascript:" — assert we don't.
    expect(requests.publishedContentCreateSchema.safeParse({ url: 'data:text/html,x' }).success).toBe(false);
  });

  it('isSafeDisplayUrl / isHttpUrl behave as documented', () => {
    expect(requests.isSafeDisplayUrl('javascript:alert(1)')).toBe(false);
    expect(requests.isSafeDisplayUrl('https://ok')).toBe(true);
    expect(requests.isSafeDisplayUrl('/rel')).toBe(true);
    expect(requests.isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(requests.isHttpUrl('https://ok')).toBe(true);
    expect(requests.isHttpUrl('/rel')).toBe(false); // not absolute
  });
});

describe('SEC-01 — route enforces the guard end-to-end', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    auth = admin.auth;
    userId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(userId);
  });

  it('POST /brands with a javascript: logoUrl is rejected; a https one is stored', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/brands',
      headers: auth,
      payload: { name: `XSS Brand ${Date.now()}`, logoUrl: 'javascript:alert(document.cookie)' },
    });
    expect(bad.statusCode).toBe(422);

    const okName = `Safe Brand ${Date.now()}`;
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/brands',
      headers: auth,
      payload: { name: okName, logoUrl: 'https://cdn.example.com/logo.png' },
    });
    expect(ok.statusCode).toBe(201);

    // Cleanup the created brand.
    const created = ok.json() as { id: string };
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.delete({ where: { id: created.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });
});
