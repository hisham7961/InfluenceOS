import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  InfluencerDetailDTO,
  InfluencerSummaryDTO,
  LogisticsIssueDTO,
  Paginated,
  ProductShipmentDTO,
  PublishedContentDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Master Reconciliation pass — RoleProfile capability matrix, proven with
 * real HTTP mutation calls (app.inject), never UI visibility. Companion to
 * the capability *definitions* in packages/domain/src/lib/capabilities.ts:
 * this file is the regression lock that each RoleProfile's default
 * capability set (ADMIN/GENERAL_MANAGER/OPERATIONS_MANAGER/LOGISTICS/
 * INFLUENCER_MANAGER/VIEWER) is actually enforced via requireCapability() at
 * the service layer — CAMPAIGNS_MANAGE/INFLUENCERS_MANAGE/CONTENT_MANAGE/
 * FINANCE_MANAGE were defined but never enforced until that pass; this
 * suite is what keeps that fixed.
 *
 * Two additional real gaps surfaced while writing this suite (both outside
 * the four capabilities the Master Reconciliation pass fixed) are called
 * out at their assertions below and were NOT fixed here — see this file's
 * final report for exact file:line references.
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

/** A throwaway legacy STAFF user (no RoleProfile), logged in immediately. */
async function createStaff(app: FastifyInstance, label: string): Promise<{ userId: string; email: string; password: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `rpm_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({ data: { email, name: `RPM ${label}`, role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, email, password, auth: { authorization: `Bearer ${token}` } };
}

/**
 * A STAFF user with a given Role Profile (and optionally brand/country
 * scope) set BEFORE first login. A roleProfile PATCH after login revokes
 * existing sessions (SEC-03 — see auth.service.ts's updateUser), so every
 * profile/scope change here happens before the one and only login. Brand-
 * access and country-access PUTs do NOT revoke sessions (only role/
 * roleProfile/isActive changes do), so they're safe to layer on afterward,
 * but for a single clean login we still set everything up first.
 */
async function createProfiledStaff(
  app: FastifyInstance,
  admin: Record<string, string>,
  label: string,
  roleProfile: string,
  opts: { brandIds?: string[]; countryCodes?: string[] } = {},
): Promise<{ userId: string; email: string; password: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `rpm_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({ data: { email, name: `RPM ${label}`, role: 'STAFF', passwordHash: await hash(password) } });
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
  return { userId: user.id, email, password, auth: { authorization: `Bearer ${token}` } };
}

async function createShipmentFixture(
  app: FastifyInstance,
  admin: Record<string, string>,
  opts: { brandName: string; influencerCountry: string; destinationCountry: string; full?: boolean },
): Promise<{ brandId: string; campaignId: string; influencerId: string; ciId: string; shipmentId: string }> {
  const brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: opts.brandName } }));
  const campaignId = idOf(
    await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `${opts.brandName} Campaign` } }),
  );
  const influencerId = idOf(
    await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: admin,
      payload: { displayName: `${opts.brandName} Creator ${Date.now()}`, countryCode: opts.influencerCountry },
    }),
  );
  const ciId = idOf(
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: admin,
      payload: { influencerId, dealType: 'GIFTED_PRODUCT' },
    }),
  );
  const shipmentId = idOf(
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipments`,
      headers: admin,
      payload: opts.full
        ? {
            recipientName: 'Matrix Recipient',
            phone: '+96555512345',
            addressLine1: 'Matrix Street 1',
            city: 'Kuwait City',
            destinationCountryCode: opts.destinationCountry,
            items: [{ productName: 'Kit' }],
          }
        : { destinationCountryCode: opts.destinationCountry, items: [{ productName: 'Kit' }] },
    }),
  );
  return { brandId, campaignId, influencerId, ciId, shipmentId };
}

describe('Role Profile Matrix — API-level regression coverage (Master Reconciliation pass)', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
  });

  // -------------------------------------------------------------------
  // 1. ADMIN — can do everything (spot check).
  // -------------------------------------------------------------------
  describe('ADMIN', () => {
    let brandId: string;

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
      await prisma.$disconnect();
    });

    it('can create a campaign and an influencer — every capability, unconditionally', async () => {
      brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `ADMIN Matrix Brand ${Date.now()}` } }));
      const campaign = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `ADMIN Matrix Campaign ${Date.now()}` } });
      expect(campaign.statusCode).toBe(201);

      const influencer = await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: { displayName: `ADMIN Matrix Creator ${Date.now()}`, countryCode: 'KW' },
      });
      expect(influencer.statusCode).toBe(201);

      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.influencer.delete({ where: { id: idOf(influencer) } }).catch(() => undefined);
      await prisma.$disconnect();
    });
  });

  // -------------------------------------------------------------------
  // 2. GENERAL_MANAGER — broad business capabilities, but the ADMIN-only
  //    role gate (requireAdmin) still stands even though GM holds
  //    CAMPAIGNS_MANAGE/INFLUENCERS_MANAGE/CONTENT_MANAGE.
  // -------------------------------------------------------------------
  describe('GENERAL_MANAGER', () => {
    let gm: { userId: string; auth: Record<string, string> };
    let brandId: string;
    let campaignId: string;
    let influencerId: string;

    beforeAll(async () => {
      gm = await createProfiledStaff(app, admin, 'gm', 'GENERAL_MANAGER');
      brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `GM Matrix Brand ${Date.now()}` } }));
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.publishedContent.deleteMany({ where: { influencerId } }).catch(() => undefined);
      await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
      await prisma.influencer.deleteMany({ where: { id: influencerId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(gm.userId);
    });

    it('can create and update a campaign (CAMPAIGNS_MANAGE)', async () => {
      const create = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: gm.auth, payload: { brandId, name: `GM Campaign ${Date.now()}` } });
      expect(create.statusCode).toBe(201);
      campaignId = idOf(create);
      const update = await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaignId}`, headers: gm.auth, payload: { description: 'Updated by GM' } });
      expect(update.statusCode).toBe(200);
    });

    it('can create and update an influencer (INFLUENCERS_MANAGE)', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: gm.auth,
        payload: { displayName: `GM Creator ${Date.now()}`, countryCode: 'KW' },
      });
      expect(create.statusCode).toBe(201);
      influencerId = idOf(create);
      const update = await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${influencerId}`, headers: gm.auth, payload: { city: 'Kuwait City' } });
      expect(update.statusCode).toBe(200);
    });

    it('can create content (CONTENT_MANAGE)', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/content',
        headers: gm.auth,
        payload: { url: `https://instagram.com/p/gm-matrix-${Date.now()}`, influencerId },
      });
      expect(create.statusCode).toBe(201);
    });

    it('is forbidden (403) from provider-credential / integration-secret endpoints — GM does not bypass requireAdmin', async () => {
      const read = await app.inject({ method: 'GET', url: '/api/v1/integrations/credentials', headers: gm.auth });
      expect(read.statusCode).toBe(403);
      const write = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/credentials',
        headers: gm.auth,
        payload: { key: 'YOUTUBE_API_KEY', value: 'gm-should-never-set-this' },
      });
      expect(write.statusCode).toBe(403);
    });

    it('is forbidden (403) from USERS_MANAGE-gated admin user management', async () => {
      const list = await app.inject({ method: 'GET', url: '/api/v1/users', headers: gm.auth });
      expect(list.statusCode).toBe(403);
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: gm.auth,
        payload: { email: `gm_should_not_create_${Date.now()}@example.test`, name: 'Nope', password: 'Str0ng-Passw0rd!' },
      });
      expect(create.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 3. LOGISTICS — shipment operations, but excluded from
  //    CAMPAIGNS_MANAGE/INFLUENCERS_MANAGE per capabilities.ts.
  // -------------------------------------------------------------------
  describe('LOGISTICS', () => {
    let logistics: { userId: string; auth: Record<string, string> };
    let fixture: Awaited<ReturnType<typeof createShipmentFixture>>;
    let bystander: { userId: string; auth: Record<string, string> };

    beforeAll(async () => {
      logistics = await createProfiledStaff(app, admin, 'logistics', 'LOGISTICS');
      bystander = await createStaff(app, 'logistics-bystander');
      fixture = await createShipmentFixture(app, admin, { brandName: `LOGISTICS Matrix Brand ${Date.now()}`, influencerCountry: 'KW', destinationCountry: 'KW', full: true });
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.campaign.deleteMany({ where: { brandId: fixture.brandId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: fixture.brandId } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(logistics.userId);
      await deleteUser(bystander.userId);
    });

    it('can assign a shipment (LOGISTICS_ASSIGN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shipments/${fixture.shipmentId}/assign`,
        headers: logistics.auth,
        payload: { userId: bystander.userId },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductShipmentDTO).assignedToUserId).toBe(bystander.userId);
    });

    it('can advance shipment status', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/shipments/${fixture.shipmentId}/status`, headers: logistics.auth, payload: { status: 'SHIPPED' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductShipmentDTO).status).toBe('SHIPPED');
    });

    it('can edit address/courier/tracking fields', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shipments/${fixture.shipmentId}`,
        headers: logistics.auth,
        payload: { courier: 'Aramex', trackingNumber: 'TRK-LOG-1' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductShipmentDTO).courier).toBe('Aramex');
    });

    it('can resolve a logistics issue (LOGISTICS_ISSUE_MANAGE)', async () => {
      const issue = idOf(
        await app.inject({
          method: 'POST',
          url: `/api/v1/shipments/${fixture.shipmentId}/issues`,
          headers: admin,
          payload: { type: 'OTHER', description: 'Needs logistics attention.' },
        }),
      );
      const res = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${issue}/resolve`, headers: logistics.auth });
      expect(res.statusCode).toBe(200);
      expect((res.json() as LogisticsIssueDTO).status).toBe('RESOLVED');
    });

    it('is forbidden (403) from creating a campaign — capabilities.ts excludes CAMPAIGNS_MANAGE for LOGISTICS', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: logistics.auth, payload: { brandId: fixture.brandId, name: 'Should Fail' } });
      expect(res.statusCode).toBe(403);
    });

    it('is forbidden (403) from creating or updating an influencer — capabilities.ts excludes INFLUENCERS_MANAGE for LOGISTICS', async () => {
      const create = await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: logistics.auth, payload: { displayName: 'Should Fail', countryCode: 'KW' } });
      expect(create.statusCode).toBe(403);
      const update = await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${fixture.influencerId}`, headers: logistics.auth, payload: { city: 'Should Fail' } });
      expect(update.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 4. INFLUENCER_MANAGER — influencer management + the ownership-based
  //    resolve carve-out, but excluded from general LOGISTICS_MANAGE.
  // -------------------------------------------------------------------
  describe('INFLUENCER_MANAGER', () => {
    let im: { userId: string; auth: Record<string, string> };
    let fixture: Awaited<ReturnType<typeof createShipmentFixture>>;
    let bystander: { userId: string; auth: Record<string, string> };

    beforeAll(async () => {
      im = await createProfiledStaff(app, admin, 'im', 'INFLUENCER_MANAGER');
      bystander = await createStaff(app, 'im-bystander');
      fixture = await createShipmentFixture(app, admin, { brandName: `IM Matrix Brand ${Date.now()}`, influencerCountry: 'KW', destinationCountry: 'KW' });
      // No campaign owner — clears the default-to-creating-actor fallback in
      // campaign.service.ts's create() so the responsible-employee chain in
      // logistics-issue.service.ts's resolveResponsibleUserId can fall
      // through to the influencer's own relationship owner below.
      await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${fixture.campaignId}`, headers: admin, payload: { ownerId: null } });
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.campaign.deleteMany({ where: { brandId: fixture.brandId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: fixture.brandId } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(im.userId);
      await deleteUser(bystander.userId);
    });

    it('can create and update an influencer (INFLUENCERS_MANAGE)', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: im.auth,
        payload: { displayName: `IM Creator ${Date.now()}`, countryCode: 'KW' },
      });
      expect(create.statusCode).toBe(201);
      const newId = idOf(create);
      const update = await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${newId}`, headers: im.auth, payload: { city: 'Kuwait City' } });
      expect(update.statusCode).toBe(200);
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.influencer.delete({ where: { id: newId } }).catch(() => undefined);
      await prisma.$disconnect();
    });

    it('can resolve a logistics issue explicitly assigned to them, despite lacking LOGISTICS_ISSUE_MANAGE (ownership carve-out, logistics-issue.service.ts requireResolvePermission)', async () => {
      const issue = idOf(
        await app.inject({
          method: 'POST',
          url: `/api/v1/shipments/${fixture.shipmentId}/issues`,
          headers: admin,
          payload: { type: 'MISSING_PHONE', description: 'Explicitly assigned to the Influencer Manager.', assignedToUserId: im.userId },
        }),
      );
      const res = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${issue}/resolve`, headers: im.auth });
      expect(res.statusCode).toBe(200);
      expect((res.json() as LogisticsIssueDTO).status).toBe('RESOLVED');
    });

    it("can resolve a logistics issue auto-assigned to them as the creator's relationship owner (no explicit assignment, no campaign owner — resolveResponsibleUserId falls through to Influencer.ownerId)", async () => {
      const ownerPatch = await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${fixture.influencerId}`, headers: admin, payload: { ownerId: im.userId } });
      expect(ownerPatch.statusCode).toBe(200);

      const issue = idOf(
        await app.inject({
          method: 'POST',
          url: `/api/v1/shipments/${fixture.shipmentId}/issues`,
          headers: admin,
          payload: { type: 'OTHER', description: 'No explicit assignee — should fall through to the relationship owner.' },
        }),
      );
      const created = (
        await app.inject({ method: 'GET', url: `/api/v1/shipments/${fixture.shipmentId}/issues`, headers: admin })
      ).json() as LogisticsIssueDTO[];
      expect(created.find((i) => i.id === issue)?.assignedToUserId).toBe(im.userId);

      const res = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${issue}/resolve`, headers: im.auth });
      expect(res.statusCode).toBe(200);
      expect((res.json() as LogisticsIssueDTO).status).toBe('RESOLVED');
    });

    it('is forbidden (403) from assigning a shipment to someone else — capabilities.ts excludes LOGISTICS_ASSIGN for INFLUENCER_MANAGER', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shipments/${fixture.shipmentId}/assign`,
        headers: im.auth,
        payload: { userId: bystander.userId },
      });
      expect(res.statusCode).toBe(403);
    });

    it('is forbidden (403) from editing courier/tracking fields on a shipment — capabilities.ts excludes LOGISTICS_MANAGE/LOGISTICS_ADDRESS_EDIT for INFLUENCER_MANAGER', async () => {
      // REAL GAP (not fixed here, not introduced by this suite): shipment.service.ts's
      // update() calls only requireActor(ctx) — it never calls requireCapability for
      // LOGISTICS_MANAGE or LOGISTICS_ADDRESS_EDIT (packages/domain/src/services/shipment.service.ts:486-531).
      // Only assign() is capability-gated (LOGISTICS_ASSIGN, line 560). So today ANY
      // authenticated actor in brand/country scope — including INFLUENCER_MANAGER,
      // which capabilities.ts deliberately excludes from LOGISTICS_MANAGE — can edit a
      // shipment's courier/tracking/address fields. This assertion encodes the spec
      // (403) rather than the current buggy behavior (200); see the final report.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shipments/${fixture.shipmentId}`,
        headers: im.auth,
        payload: { courier: 'Should Not Be Allowed', trackingNumber: 'TRK-IM-1' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 5. OPERATIONS_MANAGER — wide read access, CAMPAIGNS_VIEW but not
  //    CAMPAIGNS_MANAGE, and no LOGISTICS_ADDRESS_VIEW.
  // -------------------------------------------------------------------
  describe('OPERATIONS_MANAGER', () => {
    let ops: { userId: string; auth: Record<string, string> };
    let fixture: Awaited<ReturnType<typeof createShipmentFixture>>;

    beforeAll(async () => {
      ops = await createProfiledStaff(app, admin, 'ops', 'OPERATIONS_MANAGER');
      fixture = await createShipmentFixture(app, admin, { brandName: `OPS Matrix Brand ${Date.now()}`, influencerCountry: 'KW', destinationCountry: 'KW', full: true });
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.campaign.deleteMany({ where: { brandId: fixture.brandId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: fixture.brandId } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(ops.userId);
    });

    it('can read campaign / content / needs-attention data', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/v1/campaigns', headers: ops.auth })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/content/feed', headers: ops.auth })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/dashboard/attention', headers: ops.auth })).statusCode).toBe(200);
    });

    it('sees a shipment exists but its address/phone come back redacted (no LOGISTICS_ADDRESS_VIEW) — shipment.service.ts redact()', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/shipments/${fixture.shipmentId}`, headers: ops.auth });
      expect(res.statusCode).toBe(200);
      const shipment = res.json() as ProductShipmentDTO;
      expect(shipment.status).toBeDefined();
      expect(shipment.phone).toBeNull();
      expect(shipment.addressLine1).toBeNull();
    });

    it('is forbidden (403) from campaign/influencer/content MANAGE actions — capabilities.ts gives OPERATIONS_MANAGER CAMPAIGNS_VIEW, not MANAGE', async () => {
      const campaign = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: ops.auth, payload: { brandId: fixture.brandId, name: 'Should Fail' } });
      expect(campaign.statusCode).toBe(403);
      const influencer = await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: ops.auth, payload: { displayName: 'Should Fail', countryCode: 'KW' } });
      expect(influencer.statusCode).toBe(403);
      const content = await app.inject({ method: 'POST', url: '/api/v1/content', headers: ops.auth, payload: { url: `https://instagram.com/p/ops-matrix-${Date.now()}`, influencerId: fixture.influencerId } });
      expect(content.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 6. VIEWER — a single cross-check (full coverage lives in
  //    viewer-role.test.ts; this just confirms it still holds).
  // -------------------------------------------------------------------
  describe('VIEWER', () => {
    let viewer: { userId: string; auth: Record<string, string> };
    let brandId: string;

    beforeAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const { hash } = await import('@node-rs/argon2');
      const prisma = new PrismaClient();
      const email = `rpm_viewer_${Date.now()}@example.test`;
      const password = 'Str0ng-Passw0rd!';
      const user = await prisma.user.create({ data: { email, name: 'RPM Viewer', role: 'VIEWER', passwordHash: await hash(password) } });
      await prisma.$disconnect();
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
      viewer = { userId: user.id, auth: { authorization: `Bearer ${token}` } };
      brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `VIEWER Matrix Brand ${Date.now()}` } }));
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(viewer.userId);
    });

    it('every write (POST/PATCH/DELETE) across different resource types is refused 403 (cross-check of viewer-role.test.ts)', async () => {
      const post = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: viewer.auth, payload: { brandId, name: 'Nope' } });
      expect(post.statusCode).toBe(403);
      const patch = await app.inject({ method: 'PATCH', url: `/api/v1/brands/${brandId}`, headers: viewer.auth, payload: { name: 'Nope' } });
      expect(patch.statusCode).toBe(403);
      const del = await app.inject({ method: 'DELETE', url: `/api/v1/brands/${brandId}`, headers: viewer.auth });
      expect(del.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 7. Brand × Country intersection — both dimensions ANDed, not either
  //    alone (scopedBrandIds / scopedCountryCodes composed together).
  // -------------------------------------------------------------------
  describe('Brand x Country scope intersection', () => {
    let brandA: string;
    let brandB: string;
    let brandC: string;
    let infA_KW: string;
    let infB_SA: string;
    let infC_KW: string;
    let infA_AE: string;
    let scoped: { userId: string; auth: Record<string, string> };

    beforeAll(async () => {
      brandA = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `Matrix Brand A (JUVELAB-like) ${Date.now()}` } }));
      brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `Matrix Brand B (MEDEE-like) ${Date.now()}` } }));
      brandC = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `Matrix Brand C (out of scope) ${Date.now()}` } }));

      infA_KW = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `A+KW ${Date.now()}`, countryCode: 'KW' } }));
      infB_SA = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `B+SA ${Date.now()}`, countryCode: 'SA' } }));
      infC_KW = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `C+KW ${Date.now()}`, countryCode: 'KW' } }));
      infA_AE = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `A+AE ${Date.now()}`, countryCode: 'AE' } }));

      const link = (brandId: string, influencerId: string) =>
        app.inject({ method: 'POST', url: '/api/v1/brand-influencers', headers: admin, payload: { brandId, influencerId } });
      await Promise.all([link(brandA, infA_KW), link(brandB, infB_SA), link(brandC, infC_KW), link(brandA, infA_AE)]);

      scoped = await createProfiledStaff(app, admin, 'brand-country', 'INFLUENCER_MANAGER', {
        brandIds: [brandA, brandB],
        countryCodes: ['KW', 'SA'],
      });
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.influencer.deleteMany({ where: { id: { in: [infA_KW, infB_SA, infC_KW, infA_AE] } } }).catch(() => undefined);
      await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB, brandC] } } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(scoped.userId);
    });

    it('directory list contains BrandA+KW and BrandB+SA, but NOT BrandC+KW (brand out of scope) NOR BrandA+AE (country out of scope) — both dimensions ANDed', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/influencers?pageSize=100', headers: scoped.auth });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Paginated<InfluencerSummaryDTO>).data.map((r) => r.id);
      expect(ids).toContain(infA_KW);
      expect(ids).toContain(infB_SA);
      expect(ids).not.toContain(infC_KW);
      expect(ids).not.toContain(infA_AE);
    });

    it('direct-by-id GET on the country-out-of-scope influencer (BrandA+AE) is rejected 404 — influencer.service.ts detail() enforces country scope', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${infA_AE}`, headers: scoped.auth });
      expect(res.statusCode).toBe(404);
    });

    it('direct-by-id GET on the brand-out-of-scope influencer (BrandC+KW) is rejected 404', async () => {
      // REAL GAP (not fixed here, not introduced by this suite): influencer.service.ts's
      // detail() (and update()) call scopedCountryCodes()/isCountryOutOfScope() but never
      // scopedBrandIds()/isBrandOutOfScope() — scopedBrandIds is used ONLY inside list()'s
      // buildWhere() (packages/domain/src/services/influencer.service.ts:57-84,74). detail()
      // is at line 313-323 and update() at line 472-477: both check country scope only. So a
      // brand-scoped actor who guesses/already has an out-of-scope-brand-but-in-scope-country
      // influencer's id can read (and, holding INFLUENCERS_MANAGE, edit) it directly — the
      // brand dimension of scope is enforced for the LIST endpoint but not for direct-ID
      // access, unlike every other brand-scoped resource in this codebase (shipments,
      // content, campaign-influencers all check isBrandOutOfScope by direct id too). This
      // assertion encodes the spec (404) rather than the current buggy behavior (200); see
      // the final report.
      const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${infC_KW}`, headers: scoped.auth });
      expect(res.statusCode).toBe(404);
    });
  });
});
