import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignCandidateDTO, NoteDTO, UsageRightDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate, section 10 — "child resource bypasses
 * parent scope". Each service below resolves a campaignId/brandId to a child
 * record (a sourcing candidate, a Campaign Chat message, a usage right)
 * without ever checking the resolving id against the actor's OWN
 * UserBrandAccess — so a brand-scoped actor could reach another brand's data
 * just by supplying the parent id directly, even though it never shows up in
 * any list they can see. This proves the fix for sourcing.service.ts,
 * note.service.ts (Campaign Chat) and usage-right.service.ts: every
 * direct-ID path 404s exactly like a record that does not exist, and the
 * actor's own in-scope brand keeps working normally.
 *
 * Two distinct users cover the two distinct gaps that existed here:
 *  - `scopedStaff` (legacy STAFF, brand-scoped to Brand A only) exercises the
 *    SCOPE check — capability passes (legacy STAFF keeps broad capabilities),
 *    so a 404 on Brand B data can only come from the scope check.
 *  - `scopedViewer` (VIEWER Role Profile, brand-scoped to Brand A) exercises
 *    the CAPABILITY check — scope passes (Brand A is their own), so a 403 on
 *    an in-scope mutation can only come from the missing capability.
 */
describe('Security & Authorization Freeze Gate — child-resource scope (sourcing, Campaign Chat, usage rights)', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let scopedStaffId: string;
  let scopedStaffAuth: Record<string, string>;
  let scopedViewerId: string;
  let scopedViewerAuth: Record<string, string>;
  let brandA: string;
  let brandB: string;
  let campaignA: string;
  let campaignB: string;
  let influencerId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const tag = `SFG-${Date.now()}`;

  async function createUser(label: string, opts: { role: 'STAFF'; roleProfile?: 'VIEWER' }): Promise<{ userId: string; auth: Record<string, string> }> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `${tag.toLowerCase()}_${label}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: opts.role, roleProfile: opts.roleProfile ?? null, passwordHash: await hash(password) },
    });
    await prisma.$disconnect();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
    const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
    return { userId: user.id, auth: { authorization: `Bearer ${tokens.accessToken}` } };
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandA = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand A` } }));
    brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand B` } }));
    campaignA = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandA, name: `${tag} Camp A` } }));
    campaignB = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandB, name: `${tag} Camp B` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} Creator`, countryCode: 'KW' } }));

    ({ userId: scopedStaffId, auth: scopedStaffAuth } = await createUser('staff', { role: 'STAFF' }));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${scopedStaffId}/brand-access`, headers: admin, payload: { brandIds: [brandA] } });

    ({ userId: scopedViewerId, auth: scopedViewerAuth } = await createUser('viewer', { role: 'STAFF', roleProfile: 'VIEWER' }));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${scopedViewerId}/brand-access`, headers: admin, payload: { brandIds: [brandA] } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(scopedStaffId);
    await deleteUser(scopedViewerId);
    await deleteUser(adminId);
  });

  describe('sourcing (campaign candidate) pipeline', () => {
    let candidateB: CampaignCandidateDTO;

    beforeAll(async () => {
      candidateB = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignB}/candidates`,
          headers: admin,
          payload: { influencerId },
        })
      ).json() as CampaignCandidateDTO;
    });

    it('a Brand-A-scoped staff user cannot list or add candidates on Brand B campaign via direct campaignId', async () => {
      const list = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignB}/candidates`, headers: scopedStaffAuth });
      expect(list.statusCode).toBe(404);

      const add = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignB}/candidates`, headers: scopedStaffAuth, payload: { influencerId },
      });
      expect(add.statusCode).toBe(404);
    });

    it('a Brand-A-scoped staff user CAN add a candidate on their own campaign', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignA}/candidates`, headers: scopedStaffAuth, payload: { influencerId },
      });
      expect(res.statusCode).toBe(201);
    });

    it('a Brand-A-scoped staff user cannot get/update/decide/convert/remove a Brand B candidate by direct id', async () => {
      expect((await app.inject({ method: 'GET', url: `/api/v1/candidates/${candidateB.id}`, headers: scopedStaffAuth })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/v1/candidates/${candidateB.id}`, headers: scopedStaffAuth, payload: { notes: 'nope' } }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST', url: `/api/v1/candidates/${candidateB.id}/decision`, headers: scopedStaffAuth, payload: { decision: 'SHORTLIST' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST', url: `/api/v1/candidates/${candidateB.id}/convert`, headers: scopedStaffAuth, payload: { dealType: 'PAID' },
          })
        ).statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/candidates/${candidateB.id}`, headers: scopedStaffAuth })).statusCode).toBe(404);
    });

    it('a VIEWER-profile user in scope for Brand A is still refused (403) — capability, not scope, is the gate', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignA}/candidates`, headers: scopedViewerAuth, payload: { influencerId },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Campaign Chat (note.service.ts campaign context)', () => {
    it('a Brand-A-scoped staff user cannot list or post Campaign Chat messages for a Brand B campaign via direct campaignId', async () => {
      const list = await app.inject({ method: 'GET', url: `/api/v1/notes?campaignId=${campaignB}`, headers: scopedStaffAuth });
      expect(list.statusCode).toBe(404);

      const post = await app.inject({
        method: 'POST', url: '/api/v1/notes', headers: scopedStaffAuth, payload: { campaignId: campaignB, body: 'should never land' },
      });
      expect(post.statusCode).toBe(404);
    });

    it('a Brand-A-scoped staff user CAN list and post Campaign Chat on their own campaign', async () => {
      const post = await app.inject({
        method: 'POST', url: '/api/v1/notes', headers: scopedStaffAuth, payload: { campaignId: campaignA, body: 'hello from brand A' },
      });
      expect(post.statusCode).toBe(201);
      const created = post.json() as NoteDTO;
      expect(created.campaignId).toBe(campaignA);

      const list = (await app.inject({ method: 'GET', url: `/api/v1/notes?campaignId=${campaignA}`, headers: scopedStaffAuth })).json() as {
        data: NoteDTO[];
      };
      expect(list.data.some((n) => n.id === created.id)).toBe(true);
    });
  });

  describe('usage rights (content-licensing ledger)', () => {
    let rightB: UsageRightDTO;

    beforeAll(async () => {
      rightB = (
        await app.inject({ method: 'POST', url: `/api/v1/brands/${brandB}/usage-rights`, headers: admin, payload: { usageType: 'ORGANIC' } })
      ).json() as UsageRightDTO;
    });

    it('a Brand-A-scoped staff user cannot list or create usage rights for Brand B via direct brandId', async () => {
      const list = await app.inject({ method: 'GET', url: `/api/v1/brands/${brandB}/usage-rights`, headers: scopedStaffAuth });
      expect(list.statusCode).toBe(404);

      const create = await app.inject({
        method: 'POST', url: `/api/v1/brands/${brandB}/usage-rights`, headers: scopedStaffAuth, payload: { usageType: 'ORGANIC' },
      });
      expect(create.statusCode).toBe(404);
    });

    it('a Brand-A-scoped staff user cannot get/update/revoke a Brand B usage right by direct id', async () => {
      expect((await app.inject({ method: 'GET', url: `/api/v1/usage-rights/${rightB.id}`, headers: scopedStaffAuth })).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: 'PATCH', url: `/api/v1/usage-rights/${rightB.id}`, headers: scopedStaffAuth, payload: { notes: 'nope' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: `/api/v1/usage-rights/${rightB.id}/revoke`, headers: scopedStaffAuth })).statusCode,
      ).toBe(404);
    });

    it('a Brand-A-scoped staff user CAN create a usage right for their own brand', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/brands/${brandA}/usage-rights`, headers: scopedStaffAuth, payload: { usageType: 'ORGANIC' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('a VIEWER-profile user in scope for Brand A is still refused (403) — capability, not scope, is the gate', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/brands/${brandA}/usage-rights`, headers: scopedViewerAuth, payload: { usageType: 'ORGANIC' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
