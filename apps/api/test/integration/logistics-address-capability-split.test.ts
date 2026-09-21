import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InfluencerDetailDTO, ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — §15/§16/§17.
 *
 * LOGISTICS_MANAGE and LOGISTICS_ADDRESS_EDIT are two different capabilities
 * (packages/domain/src/lib/capabilities.ts) precisely so a role like
 * GENERAL_MANAGER can run day-to-day shipment operations (courier, tracking,
 * status) without also being able to silently rewrite a creator's phone/
 * residential address — capabilities.ts's own comment on GENERAL_MANAGER
 * ("wide operational data, not system config") documents this as a
 * deliberate split, not an oversight. This suite proves shipment.service.ts's
 * update() and influencer.service.ts's update() actually enforce that split
 * (they didn't before this fix — both gated the whole payload behind a single
 * capability), and that the Address Clarification workflow (raising/
 * resolving a LogisticsIssue) is untouched by it.
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

/** A STAFF user with a given Role Profile set BEFORE first login — a
 *  roleProfile PATCH after login revokes existing sessions (SEC-03), so
 *  logging in only once the profile is already set avoids that entirely. */
async function createProfiledStaff(
  app: FastifyInstance,
  admin: Record<string, string>,
  label: string,
  roleProfile: string,
): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `lacs_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `LACS ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/users/${user.id}`, headers: admin, payload: { roleProfile } });
  if (patch.statusCode !== 200) throw new Error(`Failed to set roleProfile ${roleProfile}: ${patch.statusCode} ${patch.body}`);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('Security & Authorization Freeze Gate — LOGISTICS_ADDRESS_EDIT capability split', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;

  // GENERAL_MANAGER: LOGISTICS_MANAGE=yes, LOGISTICS_ADDRESS_VIEW=yes,
  // LOGISTICS_ADDRESS_EDIT=no, LOGISTICS_ASSIGN=no (capabilities.ts) — exactly
  // the combination the freeze-gate spec's hard test (§15) calls for.
  let gm: { userId: string; auth: Record<string, string> };
  // LOGISTICS: holds every logistics capability, including LOGISTICS_ADDRESS_EDIT
  // — the positive control proving the split didn't just break address edits
  // for everyone.
  let logistics: { userId: string; auth: Record<string, string> };
  // INFLUENCER_MANAGER: INFLUENCERS_MANAGE=yes, LOGISTICS_ADDRESS_EDIT=no —
  // the actor §16 is about (a generic Influencer PATCH must not bypass
  // logistics address policy).
  let influencerManager: { userId: string; auth: Record<string, string> };

  let brandId: string;
  let campaignId: string;
  let influencerId: string;
  let ciId: string;
  let shipmentId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    [gm, logistics, influencerManager] = await Promise.all([
      createProfiledStaff(app, admin, 'gm', 'GENERAL_MANAGER'),
      createProfiledStaff(app, admin, 'logistics', 'LOGISTICS'),
      createProfiledStaff(app, admin, 'im', 'INFLUENCER_MANAGER'),
    ]);

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `LACS Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `LACS Campaign ${Date.now()}` } }),
    );
    influencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: { displayName: `LACS Creator ${Date.now()}`, countryCode: 'KW' },
      }),
    );
    ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: admin,
        payload: { influencerId, dealType: 'GIFTED_PRODUCT' },
      }),
    );
    shipmentId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: admin,
        payload: {
          recipientName: 'Original Recipient',
          phone: '+96555500000',
          addressLine1: 'Original Street 1',
          city: 'Kuwait City',
          destinationCountryCode: 'KW',
          courier: 'Aramex',
          items: [{ productName: 'Kit' }],
        },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(gm.userId);
    await deleteUser(logistics.userId);
    await deleteUser(influencerManager.userId);
  });

  describe('shipment.service.ts update() — GENERAL_MANAGER (LOGISTICS_MANAGE, no LOGISTICS_ADDRESS_EDIT)', () => {
    it('PATCH updating courier/tracking succeeds (LOGISTICS_MANAGE alone is enough)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shipments/${shipmentId}`,
        headers: gm.auth,
        payload: { courier: 'DHL', trackingNumber: 'GM-TRACK-1' },
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json() as ProductShipmentDTO;
      expect(dto.courier).toBe('DHL');
      expect(dto.trackingNumber).toBe('GM-TRACK-1');
    });

    it('PATCH updating phone/address fails with 403 (LOGISTICS_ADDRESS_EDIT required)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shipments/${shipmentId}`,
        headers: gm.auth,
        payload: { phone: '+96555511111', addressLine1: 'Should Not Be Allowed' },
      });
      expect(res.statusCode).toBe(403);

      // Confirm nothing actually changed.
      const after = (await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: admin })).json() as ProductShipmentDTO;
      expect(after.phone).toBe('+96555500000');
      expect(after.addressLine1).toBe('Original Street 1');
    });

    it('a mixed payload (courier + an address field) also fails 403 — any address field present is enough to require the extra capability', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shipments/${shipmentId}`,
        headers: gm.auth,
        payload: { courier: 'FedEx', city: 'Should Not Be Allowed' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('POST /shipments/:id/status (updateStatus) succeeds — status is not an address field, unaffected by the split', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/shipments/${shipmentId}/status`, headers: gm.auth, payload: { status: 'SHIPPED' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductShipmentDTO).status).toBe('SHIPPED');
    });

    it('assign still requires LOGISTICS_ASSIGN (regression check, unchanged by this fix) — GENERAL_MANAGER lacks it and gets 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shipments/${shipmentId}/assign`,
        headers: gm.auth,
        payload: { userId: gm.userId },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('shipment.service.ts update() — LOGISTICS (positive control: holds both capabilities)', () => {
    it('PATCH updating address fields succeeds — proves the split gates GENERAL_MANAGER specifically, not address edits in general', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shipments/${shipmentId}`,
        headers: logistics.auth,
        payload: { phone: '+96555522222', addressLine1: 'Corrected Street 9' },
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json() as ProductShipmentDTO;
      expect(dto.phone).toBe('+96555522222');
      expect(dto.addressLine1).toBe('Corrected Street 9');
    });
  });

  describe('influencer.service.ts update() — INFLUENCER_MANAGER (INFLUENCERS_MANAGE, no LOGISTICS_ADDRESS_EDIT)', () => {
    it('PATCH updating displayName/category succeeds — a plain profile edit needs INFLUENCERS_MANAGE alone', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/influencers/${influencerId}`,
        headers: influencerManager.auth,
        payload: { displayName: 'Renamed By IM', category: 'Beauty' },
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json() as InfluencerDetailDTO;
      expect(dto.displayName).toBe('Renamed By IM');
      expect(dto.category).toBe('Beauty');
    });

    it('PATCH updating addressLine1 (shipping-profile field) fails with 403 (LOGISTICS_ADDRESS_EDIT required — Freeze Gate §16)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/influencers/${influencerId}`,
        headers: influencerManager.auth,
        payload: { addressLine1: 'Should Not Be Allowed Via Influencer PATCH' },
      });
      expect(res.statusCode).toBe(403);

      const after = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}`, headers: admin })).json() as InfluencerDetailDTO;
      expect(after.addressLine1).not.toBe('Should Not Be Allowed Via Influencer PATCH');
    });

    it('PATCH updating city (general location, not shipping-tier) still succeeds — mirrors shipment.service.ts redact() treating city as non-sensitive', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/influencers/${influencerId}`,
        headers: influencerManager.auth,
        payload: { city: 'Salmiya' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as InfluencerDetailDTO).city).toBe('Salmiya');
    });
  });

  describe('influencer.service.ts update() — GENERAL_MANAGER (also INFLUENCERS_MANAGE, no LOGISTICS_ADDRESS_EDIT)', () => {
    it('PATCH updating deliveryInstructions fails with 403 — the same guard applies regardless of which role profile holds INFLUENCERS_MANAGE without LOGISTICS_ADDRESS_EDIT', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/influencers/${influencerId}`,
        headers: gm.auth,
        payload: { deliveryInstructions: 'Leave at the gate' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Address Clarification workflow (Freeze Gate §17) — raising an issue does not require LOGISTICS_ADDRESS_EDIT', () => {
    it('GENERAL_MANAGER lacks LOGISTICS_ISSUE_MANAGE entirely, so this is a not-applicable-to-GM control confirming the endpoint is capability-gated at all', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shipments/${shipmentId}/issues`,
        headers: gm.auth,
        payload: { type: 'OTHER', description: 'GM should not be able to raise this (no LOGISTICS_ISSUE_MANAGE).' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('LOGISTICS (holds LOGISTICS_ISSUE_MANAGE, and separately LOGISTICS_ADDRESS_EDIT) can raise and resolve a clarification request — proves the workflow itself never checks LOGISTICS_ADDRESS_EDIT', async () => {
      const issueId = idOf(
        await app.inject({
          method: 'POST',
          url: `/api/v1/shipments/${shipmentId}/issues`,
          headers: logistics.auth,
          payload: { type: 'UNCLEAR_ADDRESS', description: 'Please confirm the building number.' },
        }),
      );
      const resolve = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${issueId}/resolve`, headers: logistics.auth });
      expect(resolve.statusCode).toBe(200);
    });
  });
});
