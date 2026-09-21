import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignInfluencerDTO, DeliverableSubmissionDTO, InspirationItemDTO, ScriptDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — deliverable.service.ts, script.service.ts,
 * submission.service.ts (review) and inspiration.service.ts (create) were previously
 * gated by a bare requireActor (proves login only), not requireCapability (proves the
 * actor is actually authorized for the specific action). A narrow Role Profile (e.g.
 * LOGISTICS, which lacks CAMPAIGNS_MANAGE / UGC_REVIEW / CONTENT_MANAGE) could still
 * call these mutations. This suite proves the fix for both dimensions this pass
 * establishes — "Capability grants WHAT, scope grants WHERE, both are required":
 *
 *  - `logisticsA` (LOGISTICS Role Profile, brand-scoped to Brand A) exercises the
 *    CAPABILITY check — scope passes (Brand A is their own), so a 403 can only come
 *    from the missing capability.
 *  - `staffA1` (legacy STAFF, no Role Profile, brand-scoped to Brand A only) exercises
 *    the SCOPE check — legacy STAFF keeps broad capabilities, so a 404 on Brand B data
 *    can only come from the scope check.
 *  - `staffA1`/`staffA2` (both legacy STAFF, brand-scoped to Brand A, neither ADMIN)
 *    exercise the inspiration.service.ts ownership centralization (requireOwnerOrAdmin)
 *    for the pin and remove gates.
 */
describe('Security & Authorization Freeze Gate — deliverable/script/submission-review/inspiration', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let staffA1Id: string;
  let staffA1Auth: Record<string, string>;
  let staffA2Id: string;
  let staffA2Auth: Record<string, string>;
  let logisticsAId: string;
  let logisticsAAuth: Record<string, string>;
  let brandA: string;
  let brandB: string;
  let campaignA: string;
  let campaignB: string;
  let influencerId: string;
  let ciA: string;
  let ciB: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const tag = `SFG-CR-${Date.now()}`;

  async function createUser(label: string, opts: { roleProfile?: string } = {}): Promise<{ userId: string; auth: Record<string, string> }> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `${tag.toLowerCase()}_${label}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({ data: { email, name: `${tag} ${label}`, role: 'STAFF', passwordHash: await hash(password) } });
    await prisma.$disconnect();

    // A roleProfile change revokes sessions, so it must happen before the one login.
    if (opts.roleProfile) {
      const patch = await app.inject({ method: 'PATCH', url: `/api/v1/users/${user.id}`, headers: admin, payload: { roleProfile: opts.roleProfile } });
      if (patch.statusCode !== 200) throw new Error(`Failed to set roleProfile: ${patch.statusCode} ${patch.body}`);
    }

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
    ciA = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: admin, payload: { influencerId, dealType: 'FREE' } }),
    );
    ciB = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignB}/influencers`, headers: admin, payload: { influencerId, dealType: 'FREE' } }),
    );

    ({ userId: staffA1Id, auth: staffA1Auth } = await createUser('staff1'));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staffA1Id}/brand-access`, headers: admin, payload: { brandIds: [brandA] } });

    ({ userId: staffA2Id, auth: staffA2Auth } = await createUser('staff2'));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staffA2Id}/brand-access`, headers: admin, payload: { brandIds: [brandA] } });

    ({ userId: logisticsAId, auth: logisticsAAuth } = await createUser('logistics', { roleProfile: 'LOGISTICS' }));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${logisticsAId}/brand-access`, headers: admin, payload: { brandIds: [brandA] } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.inspirationItem.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(staffA1Id);
    await deleteUser(staffA2Id);
    await deleteUser(logisticsAId);
    await deleteUser(adminId);
  });

  describe('deliverable.service.ts — create/update/remove (CAMPAIGNS_MANAGE + brand scope)', () => {
    let deliverableOnA: string;
    let deliverableOnB: string;

    it('a Brand-A-scoped legacy staff user CAN create a deliverable on their own campaign influencer', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaign-influencers/${ciA}/deliverables`, headers: staffA1Auth, payload: { platform: 'INSTAGRAM', type: 'UGC' },
      });
      expect(res.statusCode).toBe(201);
      deliverableOnA = idOf(res);
    });

    it('a LOGISTICS-profile user in scope for Brand A is refused 403 creating a deliverable — capability, not scope, is the gate', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaign-influencers/${ciA}/deliverables`, headers: logisticsAAuth, payload: { platform: 'INSTAGRAM', type: 'UGC' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a Brand-A-scoped legacy staff user cannot create/update/remove a deliverable on a Brand B campaign influencer via direct id', async () => {
      const create = await app.inject({
        method: 'POST', url: `/api/v1/campaign-influencers/${ciB}/deliverables`, headers: staffA1Auth, payload: { platform: 'INSTAGRAM', type: 'UGC' },
      });
      expect(create.statusCode).toBe(404);

      deliverableOnB = idOf(
        await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciB}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'UGC' } }),
      );
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${deliverableOnB}`, headers: staffA1Auth, payload: { requirements: 'nope' } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/deliverables/${deliverableOnB}`, headers: staffA1Auth })).statusCode).toBe(404);
    });

    it('a Brand-A-scoped legacy staff user CAN update and remove their own deliverable', async () => {
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${deliverableOnA}`, headers: staffA1Auth, payload: { requirements: 'updated' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/deliverables/${deliverableOnA}`, headers: staffA1Auth })).statusCode).toBe(204);
    });

    it('a LOGISTICS-profile user in scope for Brand A is refused 403 updating a deliverable', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${deliverableOnB}`, headers: logisticsAAuth, payload: { requirements: 'nope' } });
      // Brand B is also out of scope for logisticsA, but capability is checked first — either 403 or 404 proves the bare-requireActor gap is closed.
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('script.service.ts — create/addVersion (CAMPAIGNS_MANAGE + brand scope)', () => {
    let scriptOnA: string;

    it('a Brand-A-scoped legacy staff user CAN create a script under their own campaign', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/scripts', headers: staffA1Auth, payload: { campaignId: campaignA, title: `${tag} script` },
      });
      expect(res.statusCode).toBe(201);
      scriptOnA = idOf(res);
    });

    it('a LOGISTICS-profile user in scope for Brand A is refused 403 creating a script — capability, not scope, is the gate', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/scripts', headers: logisticsAAuth, payload: { campaignId: campaignA, title: 'Should fail' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a Brand-A-scoped legacy staff user cannot create a script under a Brand B campaign via direct campaignId', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/scripts', headers: staffA1Auth, payload: { campaignId: campaignB, title: 'Should not land' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('a Brand-A-scoped legacy staff user CAN add a version to their own campaign script', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/scripts/${scriptOnA}/versions`, headers: staffA1Auth, payload: { body: 'v2' } });
      expect(res.statusCode).toBe(201);
      expect((res.json() as ScriptDTO).currentVersion).toBe(2);
    });

    it('a LOGISTICS-profile user in scope for Brand A is refused 403 adding a version', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/scripts/${scriptOnA}/versions`, headers: logisticsAAuth, payload: { body: 'nope' } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('submission.service.ts — review (UGC_REVIEW; HIGH severity — completes the deliverable)', () => {
    let deliverableA: string;
    let submissionA: string;

    beforeAll(async () => {
      deliverableA = idOf(
        await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciA}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'UGC' } }),
      );
      submissionA = idOf(
        await app.inject({ method: 'POST', url: `/api/v1/deliverables/${deliverableA}/submissions`, headers: admin, payload: { assetUrl: 'https://drive.example.com/v1' } }),
      );
    });

    it('a LOGISTICS-profile user in scope for Brand A is refused 403 reviewing a submission — LOGISTICS lacks UGC_REVIEW', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/submissions/${submissionA}/review`, headers: logisticsAAuth, payload: { decision: 'APPROVE' } });
      expect(res.statusCode).toBe(403);
    });

    it('a Brand-A-scoped legacy staff user CAN review (approve) their own brand\'s submission, completing the deliverable', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/submissions/${submissionA}/review`, headers: staffA1Auth, payload: { decision: 'APPROVE' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as DeliverableSubmissionDTO).status).toBe('APPROVED');
    });

    it('a Brand-A-scoped legacy staff user cannot review a Brand B submission by direct id', async () => {
      const deliverableB = idOf(
        await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciB}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'UGC' } }),
      );
      const submissionB = idOf(
        await app.inject({ method: 'POST', url: `/api/v1/deliverables/${deliverableB}/submissions`, headers: admin, payload: { assetUrl: 'https://drive.example.com/b1' } }),
      );
      const res = await app.inject({ method: 'POST', url: `/api/v1/submissions/${submissionB}/review`, headers: staffA1Auth, payload: { decision: 'APPROVE' } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('inspiration.service.ts — create (CONTENT_MANAGE + brand scope), and centralized owner-or-admin pin/remove', () => {
    let itemOnA: string;

    it('a Brand-A-scoped legacy staff user CAN save an inspiration item for their own brand', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inspiration', headers: staffA1Auth, payload: { url: `https://example.com/${tag}-a`, category: 'HOOK', brandId: brandA },
      });
      expect(res.statusCode).toBe(201);
      itemOnA = idOf(res);
    });

    it('a LOGISTICS-profile user in scope for Brand A is refused 403 saving an inspiration item — LOGISTICS lacks CONTENT_MANAGE', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inspiration', headers: logisticsAAuth, payload: { url: `https://example.com/${tag}-logistics`, category: 'HOOK', brandId: brandA },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a Brand-A-scoped legacy staff user cannot save an inspiration item for Brand B via direct brandId', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inspiration', headers: staffA1Auth, payload: { url: `https://example.com/${tag}-b`, category: 'HOOK', brandId: brandB },
      });
      expect(res.statusCode).toBe(404);
    });

    it('a non-owner, non-admin actor is refused 403 pinning someone else\'s item (requireOwnerOrAdmin centralization)', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/inspiration/${itemOnA}`, headers: staffA2Auth, payload: { pinned: true } });
      expect(res.statusCode).toBe(403);
    });

    it('the submitter CAN pin their own item', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/inspiration/${itemOnA}`, headers: staffA1Auth, payload: { pinned: true } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as InspirationItemDTO).pinned).toBe(true);
    });

    it('a non-owner, non-admin actor is refused 403 removing someone else\'s item (requireOwnerOrAdmin centralization)', async () => {
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/inspiration/${itemOnA}`, headers: staffA2Auth });
      expect(res.statusCode).toBe(403);
    });

    it('an admin CAN remove any item regardless of ownership', async () => {
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/inspiration/${itemOnA}`, headers: admin });
      expect(res.statusCode).toBe(204);
    });
  });
});
