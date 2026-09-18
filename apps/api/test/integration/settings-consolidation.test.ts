import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ClientConfigDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W4-2 cleanups — decorative settings removed:
 *  - the upload limit is a single source of truth (MAX_UPLOAD_MB); a DB value
 *    cannot be set and cannot override what the server actually enforces;
 *  - integration provider credentials are never written to the database.
 */
describe('W4-2 — settings consolidation (no decorative controls)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  const expectedMb = Math.round((Number(process.env.MAX_UPLOAD_MB) || 50));

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(userId);
  });

  it('reports the env-enforced upload limit and ignores a DB override attempt', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/v1/client-config', headers: auth })).json() as ClientConfigDTO;
    expect(before.upload.maxUploadMb).toBe(expectedMb);

    // Attempting to set maxUploadMb via client-config is accepted (unknown key
    // stripped) but changes nothing — the enforced limit is unchanged.
    const patched = await app.inject({ method: 'PATCH', url: '/api/v1/platform/client-config', headers: auth, payload: { maxUploadMb: 999 } });
    expect(patched.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: '/api/v1/client-config', headers: auth })).json() as ClientConfigDTO;
    expect(after.upload.maxUploadMb).toBe(expectedMb);
  });

  it('never persists provider credentials sent to the integration endpoint', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/v1/integrations/YOUTUBE', headers: auth,
      payload: { isEnabled: true, config: { apiKey: 'super-secret-should-not-persist' } },
    });
    expect(res.statusCode).toBe(200);

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const row = await prisma.integrationSetting.findUnique({ where: { platform: 'YOUTUBE' }, select: { config: true } });
    await prisma.$disconnect();
    // The credential payload was stripped by the contract and never stored.
    expect(row?.config ?? null).toBeNull();
  });
});
