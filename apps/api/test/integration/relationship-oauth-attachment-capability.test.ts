import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BrandInfluencerDTO, SocialAccountDTO, UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — regression coverage for four
 * mutations that were previously gated only by `requireActor` (proves
 * login, not authorization): brand-influencer.service.ts's upsert()/
 * remove(), social-account.service.ts's create()/update()/remove(),
 * creator-oauth.service.ts's disconnect(), and attachment.service.ts's
 * initiate(). Before this fix, ANY authenticated user — regardless of role
 * profile or brand/country scope — could perform every one of these; there
 * was previously zero test coverage proving otherwise (grepped across
 * apps/api/test and packages/domain).
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

/** A STAFF user with a given Role Profile (and optional brand/country scope)
 *  set BEFORE first login — a roleProfile/scope PATCH after login revokes
 *  existing sessions (SEC-03), so logging in only once it's all set avoids
 *  that entirely. Mirrors role-profile-matrix.test.ts's own helper. */
async function createProfiledStaff(
  app: FastifyInstance,
  admin: Record<string, string>,
  label: string,
  roleProfile: string,
  opts: { brandIds?: string[]; countryCodes?: string[] } = {},
): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `roac_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `ROAC ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/users/${user.id}`, headers: admin, payload: { roleProfile } });
  if (patch.statusCode !== 200) throw new Error(`Failed to set roleProfile ${roleProfile}: ${patch.statusCode} ${patch.body}`);
  if (opts.brandIds) {
    const r = await app.inject({ method: 'PUT', url: `/api/v1/users/${user.id}/brand-access`, headers: admin, payload: { brandIds: opts.brandIds } });
    if (r.statusCode !== 200) throw new Error(`Failed to set brand access: ${r.statusCode} ${r.body}`);
  }
  if (opts.countryCodes) {
    const r = await app.inject({ method: 'PUT', url: `/api/v1/users/${user.id}/country-access`, headers: admin, payload: { countryCodes: opts.countryCodes } });
    if (r.statusCode !== 200) throw new Error(`Failed to set country access: ${r.statusCode} ${r.body}`);
  }
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('Security & Authorization Freeze Gate — brand-influencer / social-account / creator-oauth / attachment capability checks', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;

  // OPERATIONS_MANAGER holds neither INFLUENCERS_MANAGE nor CAMPAIGNS_MANAGE
  // (capabilities.ts) — the negative control for every capability check below.
  let opsManager: { userId: string; auth: Record<string, string> };
  // INFLUENCER_MANAGER holds INFLUENCERS_MANAGE, scoped to brandA/KW only —
  // proves capability alone is not enough; brand/country scope is also required.
  let imScoped: { userId: string; auth: Record<string, string> };

  let brandA: string;
  let brandB: string;
  let campaignOnA: string;
  let campaignOnB: string;
  let influencerKW: string;
  let influencerSA: string;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandA = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `ROAC Brand A ${Date.now()}` } }));
    brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `ROAC Brand B ${Date.now()}` } }));
    campaignOnA = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandA, name: `ROAC Campaign A ${Date.now()}` } }));
    campaignOnB = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandB, name: `ROAC Campaign B ${Date.now()}` } }));
    influencerKW = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `ROAC Creator KW ${Date.now()}`, countryCode: 'KW' } }));
    influencerSA = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `ROAC Creator SA ${Date.now()}`, countryCode: 'SA' } }));

    [opsManager, imScoped] = await Promise.all([
      createProfiledStaff(app, admin, 'ops', 'OPERATIONS_MANAGER'),
      createProfiledStaff(app, admin, 'im', 'INFLUENCER_MANAGER', { brandIds: [brandA], countryCodes: ['KW'] }),
    ]);
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.attachment.deleteMany({ where: { campaignId: { in: [campaignOnA, campaignOnB] } } }).catch(() => undefined);
    await prisma.attachment.deleteMany({ where: { influencerId: { in: [influencerKW, influencerSA] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.socialAccount.deleteMany({ where: { influencerId: { in: [influencerKW, influencerSA] } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: { in: [influencerKW, influencerSA] } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(opsManager.userId);
    await deleteUser(imScoped.userId);
  });

  describe('brand-influencer.service.ts — upsert()/remove() require INFLUENCERS_MANAGE + brand scope', () => {
    it('upsert is refused 403 for an actor without INFLUENCERS_MANAGE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/brand-influencers',
        headers: opsManager.auth,
        payload: { brandId: brandA, influencerId: influencerKW },
      });
      expect(res.statusCode).toBe(403);
    });

    it('upsert is refused 404 for a brand outside the actor\'s brand scope, even though they hold INFLUENCERS_MANAGE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/brand-influencers',
        headers: imScoped.auth,
        payload: { brandId: brandB, influencerId: influencerKW, defaultRate: 500, currency: 'KWD' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('upsert succeeds for a brand inside scope, including its financial fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/brand-influencers',
        headers: imScoped.auth,
        payload: { brandId: brandA, influencerId: influencerKW, defaultRate: 750, currency: 'KWD' },
      });
      expect(res.statusCode).toBe(201);
      const dto = res.json() as BrandInfluencerDTO;
      expect(dto.defaultRate).toBe(750);
      expect(dto.currency).toBe('KWD');

      // remove(): same capability + scope posture.
      const deniedRole = await app.inject({ method: 'DELETE', url: `/api/v1/brand-influencers/${dto.id}`, headers: opsManager.auth });
      expect(deniedRole.statusCode).toBe(403);

      const ok = await app.inject({ method: 'DELETE', url: `/api/v1/brand-influencers/${dto.id}`, headers: imScoped.auth });
      expect(ok.statusCode).toBe(204);
    });

    it('remove is refused 404 for a relationship on a brand outside scope', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/brand-influencers',
        headers: admin,
        payload: { brandId: brandB, influencerId: influencerSA },
      });
      const biId = idOf(created);
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/brand-influencers/${biId}`, headers: imScoped.auth });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('social-account.service.ts — create()/update()/remove() require INFLUENCERS_MANAGE', () => {
    it('create, update, and remove are each refused 403 for an actor without INFLUENCERS_MANAGE', async () => {
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/influencers/${influencerKW}/social-accounts`,
        headers: opsManager.auth,
        payload: { platform: 'INSTAGRAM', username: `roac_${Date.now()}` },
      });
      expect(create.statusCode).toBe(403);

      // Seed a real account (as admin) to prove update()/remove() are independently gated.
      const seeded = idOf(
        await app.inject({
          method: 'POST',
          url: `/api/v1/influencers/${influencerKW}/social-accounts`,
          headers: admin,
          payload: { platform: 'TIKTOK', username: `roac_seed_${Date.now()}` },
        }),
      );

      const update = await app.inject({ method: 'PATCH', url: `/api/v1/social-accounts/${seeded}`, headers: opsManager.auth, payload: { followers: 100 } });
      expect(update.statusCode).toBe(403);

      const remove = await app.inject({ method: 'DELETE', url: `/api/v1/social-accounts/${seeded}`, headers: opsManager.auth });
      expect(remove.statusCode).toBe(403);
    });

    it('create/update/remove succeed for an actor holding INFLUENCERS_MANAGE', async () => {
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/influencers/${influencerKW}/social-accounts`,
        headers: imScoped.auth,
        payload: { platform: 'YOUTUBE', username: `roac_im_${Date.now()}` },
      });
      expect(create.statusCode).toBe(201);
      const dto = create.json() as SocialAccountDTO;

      const update = await app.inject({ method: 'PATCH', url: `/api/v1/social-accounts/${dto.id}`, headers: imScoped.auth, payload: { followers: 42 } });
      expect(update.statusCode).toBe(200);

      const remove = await app.inject({ method: 'DELETE', url: `/api/v1/social-accounts/${dto.id}`, headers: imScoped.auth });
      expect(remove.statusCode).toBe(204);
    });
  });

  describe('creator-oauth.service.ts — disconnect() requires INFLUENCERS_MANAGE (callback() is unaffected by this fix)', () => {
    it('disconnect is refused 403 for an actor without INFLUENCERS_MANAGE', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/influencers/${influencerKW}/creator-connections/instagram`,
        headers: opsManager.auth,
      });
      expect(res.statusCode).toBe(403);
    });

    it('disconnect succeeds (ok:true, idempotent even with nothing connected) for an actor holding INFLUENCERS_MANAGE', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/influencers/${influencerKW}/creator-connections/instagram`,
        headers: imScoped.auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe('attachment.service.ts — initiate() requires a capability + the resolved target\'s brand/country scope', () => {
    it('a campaign-target upload is refused 403 for an actor with neither CAMPAIGNS_MANAGE nor INFLUENCERS_MANAGE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: opsManager.auth,
        payload: { fileName: 'brief.png', mimeType: 'image/png', sizeBytes: 10, target: { campaignId: campaignOnA } },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a campaign-target upload is refused 404 when the campaign\'s brand is outside the actor\'s brand scope, even though INFLUENCERS_MANAGE alone would satisfy the capability check', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: imScoped.auth,
        payload: { fileName: 'brief.png', mimeType: 'image/png', sizeBytes: 10, target: { campaignId: campaignOnB } },
      });
      expect(res.statusCode).toBe(404);
    });

    it('a campaign-target upload succeeds for a campaign inside the actor\'s brand scope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: imScoped.auth,
        payload: { fileName: 'brief.png', mimeType: 'image/png', sizeBytes: 10, target: { campaignId: campaignOnA } },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as UploadTicketDTO).uploadToken).toBeTruthy();
    });

    it('an influencer-target upload is refused 404 when the influencer\'s country is outside the actor\'s country scope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: imScoped.auth,
        payload: { fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 10, target: { influencerId: influencerSA } },
      });
      expect(res.statusCode).toBe(404);
    });

    it('an influencer-target upload is refused 403 for an actor without INFLUENCERS_MANAGE, and succeeds for one who holds it (and is in country scope)', async () => {
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: opsManager.auth,
        payload: { fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 10, target: { influencerId: influencerKW } },
      });
      expect(denied.statusCode).toBe(403);

      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: imScoped.auth,
        payload: { fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 10, target: { influencerId: influencerKW } },
      });
      expect(ok.statusCode).toBe(201);
    });
  });
});
