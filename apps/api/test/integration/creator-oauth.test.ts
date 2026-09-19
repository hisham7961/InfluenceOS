import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreatorConnectionDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * INT-3 — creator-OAuth connections. The flow is wired end to end but INERT
 * until the platform app passes review, so with no app credentials configured
 * (the default) `start` refuses clearly rather than pretending. This proves the
 * honest gating, the unsupported-platform guard, and the tamper-proof callback.
 */
describe('INT-3 — creator-OAuth connections (foundation)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let influencerId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `OAuth Inf ${Date.now()}` } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.creatorOAuthToken.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('a creator starts with no connections', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/creator-connections`, headers: auth })).json() as CreatorConnectionDTO[];
    expect(list).toEqual([]);
  });

  it('start refuses honestly when the Instagram app is not configured', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/influencers/${influencerId}/creator-connections/instagram/start`, headers: auth });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/not configured/i);
  });

  it('rejects a platform that has no creator-OAuth flow', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/influencers/${influencerId}/creator-connections/snapchat/start`, headers: auth });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/creator-connections` });
    expect(res.statusCode).toBe(401);
  });

  it('disconnect is a safe no-op when nothing is connected', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/influencers/${influencerId}/creator-connections/instagram`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('the callback redirects to an error page on tampered/invalid state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/integrations/instagram/oauth/callback?code=abc&state=tampered' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('connected=error');
  });
});
