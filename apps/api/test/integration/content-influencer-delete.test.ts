import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Delete/edit for published Content, and delete for an Influencer (DEL-1..4).
 * Content is a plain hard delete (its cascade is entirely self-owned
 * satellite data). An Influencer is hard-deleted only when it has no
 * campaign history; otherwise it's deactivated (isActive: false) instead —
 * see influencer.service.ts's remove() for why (mirrors note.service.ts's
 * conditional soft/hard delete, the one other precedent in this codebase).
 */
describe('Content delete/edit + Influencer delete', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const tag = `DEL-${Date.now()}`;
  const createdBrandIds: string[] = [];

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    for (const brandId of createdBrandIds) {
      await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
      await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    }
    await prisma.publishedContent.deleteMany({ where: { caption: { contains: tag } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('edits a content caption via PATCH /content/:id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}edit`, caption: `${tag} original caption` },
    });
    expect(created.statusCode).toBe(201);
    const id = idOf(created);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/content/${id}`,
      headers: auth,
      payload: { caption: `${tag} updated caption` },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as PublishedContentDTO).caption).toBe(`${tag} updated caption`);
  });

  it('deletes content via DELETE /content/:id — 204, then a subsequent GET 404s', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}del`, caption: `${tag} to delete` },
    });
    expect(created.statusCode).toBe(201);
    const id = idOf(created);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/content/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: `/api/v1/content/${id}`, headers: auth });
    expect(after.statusCode).toBe(404);
  });

  it('deleting content requires CONTENT_MANAGE — a read-only VIEWER is rejected', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}viewer`, caption: `${tag} viewer-blocked` },
    });
    const id = idOf(created);

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `del_viewer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const viewerUser = await prisma.user.create({
      data: { email, name: 'Delete Viewer', role: 'VIEWER', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    await prisma.$disconnect();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/content/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await deleteUser(viewerUser.id);
  });

  it('deleting an influencer with no campaign history hard-deletes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `${tag} No History`, countryCode: 'KW' },
    });
    expect(created.statusCode).toBe(201);
    const id = idOf(created);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/influencers/${id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { hardDeleted: boolean }).hardDeleted).toBe(true);

    const after = await app.inject({ method: 'GET', url: `/api/v1/influencers/${id}`, headers: auth });
    expect(after.statusCode).toBe(404);
  });

  it('deleting an influencer WITH campaign history deactivates it instead — nothing is destroyed', async () => {
    const brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `${tag} Brand` } }));
    createdBrandIds.push(brandId);
    const campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `${tag} Campaign` } }),
    );
    const influencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `${tag} Has History`, countryCode: 'KW' },
      }),
    );
    const ci = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: auth,
      payload: { influencerId, dealType: 'GIFTED_PRODUCT' },
    });
    expect(ci.statusCode).toBe(201);
    const campaignInfluencerId = idOf(ci);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/influencers/${influencerId}`, headers: auth });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { hardDeleted: boolean }).hardDeleted).toBe(false);

    // The influencer still exists (deactivated, not gone) and its roster
    // participation — the history being protected — is untouched.
    const after = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}`, headers: auth });
    expect(after.statusCode).toBe(200);

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const row = await prisma.influencer.findUnique({ where: { id: influencerId }, select: { isActive: true } });
    expect(row?.isActive).toBe(false);
    const ciRow = await prisma.campaignInfluencer.findUnique({ where: { id: campaignInfluencerId } });
    expect(ciRow).not.toBeNull();
    await prisma.$disconnect();
  });

  it('deleting an influencer requires INFLUENCERS_MANAGE — a read-only VIEWER is rejected', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `${tag} Viewer Blocked`, countryCode: 'KW' },
    });
    const id = idOf(created);

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `del_inf_viewer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const viewerUser = await prisma.user.create({
      data: { email, name: 'Delete Inf Viewer', role: 'VIEWER', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    await prisma.$disconnect();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/influencers/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await deleteUser(viewerUser.id);
  });
});
