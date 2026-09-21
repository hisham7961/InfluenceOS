import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  BulkPreviewDTO,
  BulkResultDTO,
  CampaignCandidateDTO,
  CampaignInfluencerDTO,
  DeliverableTemplateResultDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * SEC-4 — bulk-mutation authorization (bulk.service.ts, bulk-influencer.
 * service.ts). requireActor() proves authentication, not authorization:
 * every bulk mutation must additionally require its Capability, and every
 * ROW in a bulk operation must pass its OWN Scope check — a country- or
 * brand-scoped actor must never reach an out-of-scope creator merely
 * because the batch's target Campaign itself is in scope.
 */
describe('SEC-4 — bulk mutation capability + per-row scope', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let campaignId: string;
  let kwCreatorId: string;
  let aeCreatorId: string;

  // A STAFF user with the VIEWER role profile: read-only capabilities only
  // (no CAMPAIGNS_MANAGE / INFLUENCERS_MANAGE), and no country/brand scope
  // restriction — isolates the CAPABILITY check from the SCOPE check,
  // mirroring security-freeze-gate-child-scope.test.ts's `scopedViewer`.
  let viewerId: string;
  let viewerAuth: Record<string, string>;

  // A STAFF user with the INFLUENCER_MANAGER role profile (has
  // INFLUENCERS_MANAGE, so capability passes) restricted to KW only via
  // UserCountryAccess — isolates the per-row SCOPE check from capability.
  let kwUserId: string;
  let kwAuth: Record<string, string>;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const tag = `SEC4-${Date.now()}`;

  async function createStaffUser(
    label: string,
    roleProfile: 'VIEWER' | 'INFLUENCER_MANAGER',
  ): Promise<{ userId: string; auth: Record<string, string> }> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `${tag.toLowerCase()}_${label}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: 'STAFF', roleProfile, passwordHash: await hash(password) },
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

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `${tag} Campaign` } }),
    );
    kwCreatorId = idOf(
      await app.inject({
        method: 'POST', url: '/api/v1/influencers', headers: admin,
        payload: { displayName: `${tag} KW Creator`, primaryUsername: `${tag}_kw`, primaryPlatform: 'INSTAGRAM', countryCode: 'KW' },
      }),
    );
    aeCreatorId = idOf(
      await app.inject({
        method: 'POST', url: '/api/v1/influencers', headers: admin,
        payload: { displayName: `${tag} AE Creator`, primaryUsername: `${tag}_ae`, primaryPlatform: 'INSTAGRAM', countryCode: 'AE' },
      }),
    );

    ({ userId: viewerId, auth: viewerAuth } = await createStaffUser('viewer', 'VIEWER'));

    ({ userId: kwUserId, auth: kwAuth } = await createStaffUser('kw', 'INFLUENCER_MANAGER'));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${kwUserId}/country-access`, headers: admin, payload: { countryCodes: ['KW'] } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaignCandidate.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(viewerId);
    await deleteUser(kwUserId);
  });

  describe('capability gate — a capability-less (VIEWER) actor is refused with 403, nothing is applied', () => {
    it('bulk roster-add preview + execute', async () => {
      const preview = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers/bulk/preview`, headers: viewerAuth,
        payload: { rows: [{ influencerId: kwCreatorId, dealType: 'PAID' }] },
      });
      expect(preview.statusCode).toBe(403);

      const execute = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers/bulk`, headers: viewerAuth,
        payload: { rows: [{ influencerId: kwCreatorId, dealType: 'PAID' }] },
      });
      expect(execute.statusCode).toBe(403);

      const roster = (
        await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: admin })
      ).json() as CampaignInfluencerDTO[];
      expect(roster).toHaveLength(0);
    });

    it('deliverable template', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/deliverable-template`, headers: viewerAuth,
        payload: { target: 'all', deliverables: [{ platform: 'INSTAGRAM', type: 'REEL' }] },
      });
      expect(res.statusCode).toBe(403);
    });

    it('CSV candidate import preview + execute — no influencer or candidate is created as a side effect of the 403', async () => {
      const csv = ['displayName,country', `${tag} Viewer Blocked,Kuwait`].join('\n');

      const preview = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import/preview`, headers: viewerAuth, payload: { csv },
      });
      expect(preview.statusCode).toBe(403);

      const execute = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import`, headers: viewerAuth, payload: { csv },
      });
      expect(execute.statusCode).toBe(403);

      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      const created = await prisma.influencer.findFirst({ where: { displayName: `${tag} Viewer Blocked` } });
      expect(created).toBeNull();
      await prisma.$disconnect();

      const candidates = (
        await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: admin })
      ).json() as CampaignCandidateDTO[];
      expect(candidates).toHaveLength(0);
    });
  });

  describe('per-row scope gate — a KW-scoped actor (capability OK) cannot reach the out-of-scope AE creator', () => {
    it('bulk roster-add: preview and execute both mask the AE row as not-found, and it is never added', async () => {
      const preview = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers/bulk/preview`, headers: kwAuth,
        payload: { rows: [{ influencerId: aeCreatorId, dealType: 'PAID' }] },
      });
      expect(preview.statusCode).toBe(200);
      const previewOut = preview.json() as BulkPreviewDTO;
      expect(previewOut.willUpdate).toBe(0);
      expect(previewOut.rows[0]!.status).toBe('skipped');
      // Never reveals the out-of-scope creator's real display name.
      expect(previewOut.rows[0]!.label).toBeNull();

      const execute = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers/bulk`, headers: kwAuth,
        payload: { rows: [{ influencerId: aeCreatorId, dealType: 'PAID' }] },
      });
      expect(execute.statusCode).toBe(200);
      const executeOut = execute.json() as BulkResultDTO;
      expect(executeOut.added).toBe(0);
      expect(executeOut.results[0]!.status).toBe('failed');
      expect(executeOut.results[0]!.message).toMatch(/not found/i);

      const roster = (
        await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: admin })
      ).json() as CampaignInfluencerDTO[];
      expect(roster.find((r) => r.influencer.id === aeCreatorId)).toBeUndefined();
    });

    it('bulk roster-add: the SAME KW-scoped actor CAN add the in-scope KW creator', async () => {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers/bulk`, headers: kwAuth,
        payload: { rows: [{ influencerId: kwCreatorId, dealType: 'FREE' }] },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as BulkResultDTO;
      expect(out.added).toBe(1);
    });

    it('CSV import: an existing out-of-scope creator named in the CSV is rejected per-row, not merely because the campaign is in scope', async () => {
      const csv = ['displayName,username,platform,country', `${tag} AE Creator,${tag}_ae,INSTAGRAM,`].join('\n');

      const preview = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import/preview`, headers: kwAuth, payload: { csv },
      });
      expect(preview.statusCode).toBe(200);
      const previewOut = preview.json() as BulkPreviewDTO;
      expect(previewOut.willUpdate).toBe(0);
      expect(previewOut.rows[0]!.status).toBe('skipped');
      expect(previewOut.rows[0]!.influencerId).toBeNull();
      expect(previewOut.rows[0]!.message).toMatch(/scope/i);

      const execute = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import`, headers: kwAuth, payload: { csv },
      });
      expect(execute.statusCode).toBe(200);
      const executeOut = execute.json() as BulkResultDTO;
      expect(executeOut.added).toBe(0);
      expect(executeOut.results[0]!.status).toBe('failed');
      expect(executeOut.results[0]!.message).toMatch(/scope/i);

      const candidates = (
        await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: admin })
      ).json() as CampaignCandidateDTO[];
      expect(candidates.find((c) => c.influencer.id === aeCreatorId)).toBeUndefined();
    });

    it('CSV import: a CSV row that would CREATE a brand-new out-of-scope creator is rejected — not a side door around scope', async () => {
      const csv = ['displayName,country', `${tag} New UAE Creator,UAE`].join('\n');

      const preview = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import/preview`, headers: kwAuth, payload: { csv },
      });
      expect(preview.statusCode).toBe(200);
      const previewOut = preview.json() as BulkPreviewDTO;
      expect(previewOut.willCreate).toBe(0);
      expect(previewOut.rows[0]!.status).toBe('skipped');
      expect(previewOut.rows[0]!.message).toMatch(/scope/i);

      const execute = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import`, headers: kwAuth, payload: { csv },
      });
      expect(execute.statusCode).toBe(200);
      const executeOut = execute.json() as BulkResultDTO;
      expect(executeOut.added).toBe(0);
      expect(executeOut.results[0]!.status).toBe('failed');

      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      const created = await prisma.influencer.findFirst({ where: { displayName: `${tag} New UAE Creator` } });
      expect(created).toBeNull();
      await prisma.$disconnect();
    });

    it('CSV import: the SAME KW-scoped actor CAN import an in-scope new KW creator', async () => {
      const csv = ['displayName,country', `${tag} New KW Creator,Kuwait`].join('\n');
      const res = await app.inject({
        method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import`, headers: kwAuth, payload: { csv },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as BulkResultDTO;
      expect(out.added).toBe(1);

      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      const created = await prisma.influencer.findFirst({ where: { displayName: `${tag} New KW Creator` } });
      expect(created).not.toBeNull();
      expect(created!.countryCode).toBe('KW');
      await prisma.$disconnect();
    });
  });

  describe('bulk-influencer directory actions (bulk-influencer.service.ts)', () => {
    it('preview() masks an out-of-scope creator identically to a not-found one — never leaks its relationship status', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/influencers/bulk/preview', headers: kwAuth,
        payload: { action: 'SET_RELATIONSHIP_STATUS', influencerIds: [aeCreatorId], status: 'ACTIVE' },
      });
      expect(res.statusCode).toBe(200);
      const preview = res.json() as BulkPreviewDTO;
      expect(preview.willUpdate).toBe(0);
      expect(preview.rows[0]!.status).toBe('skipped');
      expect(preview.rows[0]!.label).toBeNull();
      expect(preview.rows[0]!.message).toMatch(/not found/i);
    });

    it('preview() still resolves the in-scope KW creator normally', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/influencers/bulk/preview', headers: kwAuth,
        payload: { action: 'SET_RELATIONSHIP_STATUS', influencerIds: [kwCreatorId], status: 'ACTIVE' },
      });
      expect(res.statusCode).toBe(200);
      const preview = res.json() as BulkPreviewDTO;
      expect(preview.willUpdate).toBe(1);
      expect(preview.rows[0]!.label).toContain('KW Creator');
    });

    it('preview() is a true dry run: an ADD_TAG preview for a brand-new tag name never creates that Tag row', async () => {
      const tagName = `${tag}-preview-only-tag`;
      const res = await app.inject({
        method: 'POST', url: '/api/v1/influencers/bulk/preview', headers: admin,
        payload: { action: 'ADD_TAG', influencerIds: [kwCreatorId], tagName },
      });
      expect(res.statusCode).toBe(200);
      const preview = res.json() as BulkPreviewDTO;
      expect(preview.willUpdate).toBe(1); // tag doesn't exist yet, so nobody already has it

      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      const created = await prisma.tag.findUnique({ where: { name: tagName } });
      expect(created).toBeNull();
      await prisma.$disconnect();
    });
  });
});
