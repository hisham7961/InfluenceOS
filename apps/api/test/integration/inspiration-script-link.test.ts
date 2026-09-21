import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InspirationItemDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-3b — Trends & Inspiration's scriptReferenceId was accepted on create but
 * could never be set or changed via update (missing from the update schema
 * and the domain update() data block) — a schema/DTO field with zero live
 * wiring. Proves the fix end to end against a real ScriptReference row: set
 * on update, denormalized title returned, then cleared.
 */
describe('OI-3b — Inspiration item <-> ScriptReference linking', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let scriptId: string;
  let itemId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Script Link Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Script Link Camp ${Date.now()}` } }),
    );
    scriptId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/scripts',
        headers: auth,
        payload: { campaignId, title: `Hook script ${Date.now()}`, body: 'Open with the problem, then the reveal.' },
      }),
    );
    itemId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/inspiration',
        headers: auth,
        payload: { url: `https://example.com/trend-${Date.now()}`, category: 'HOOK', campaignId },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.inspirationItem.deleteMany({ where: { id: itemId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('starts with no linked script', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/inspiration/${itemId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const item = res.json() as InspirationItemDTO;
    expect(item.scriptReferenceId).toBeNull();
    expect(item.scriptReferenceTitle).toBeNull();
    expect(item.campaignName).toBeTruthy();
  });

  it('links a real ScriptReference via update and returns its denormalized title', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inspiration/${itemId}`,
      headers: auth,
      payload: { scriptReferenceId: scriptId },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json() as InspirationItemDTO;
    expect(item.scriptReferenceId).toBe(scriptId);
    expect(item.scriptReferenceTitle).toContain('Hook script');

    // Confirmed persisted, not just echoed back.
    const refetched = (await app.inject({ method: 'GET', url: `/api/v1/inspiration/${itemId}`, headers: auth })).json() as InspirationItemDTO;
    expect(refetched.scriptReferenceId).toBe(scriptId);
  });

  it('unlinks the script by setting scriptReferenceId to null', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/inspiration/${itemId}`,
      headers: auth,
      payload: { scriptReferenceId: null },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json() as InspirationItemDTO;
    expect(item.scriptReferenceId).toBeNull();
    expect(item.scriptReferenceTitle).toBeNull();
  });
});
