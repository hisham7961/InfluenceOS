import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LogisticsRequestDTO, ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Advanced Roles & Logistics Operations pass — capability-based address
 * redaction. "Shipping addresses/phone numbers only visible to roles/
 * capabilities that require them... Operations Manager may see 'address
 * issue exists' without the exact address unless they hold the logistics/
 * address capability." This is a capability check (LOGISTICS_ADDRESS_VIEW),
 * never a hardcoded role check — the old code only redacted the legacy
 * VIEWER role, which meant Operations Manager saw the full address by
 * default. shipment.service.ts's redact()/redactWith() now gate on the
 * capability everywhere a ProductShipmentDTO/LogisticsRequestDTO is built.
 */
async function createStaff(
  app: FastifyInstance,
  label: string,
): Promise<{ userId: string; email: string; password: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `staff_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({ data: { email, name: `Staff ${label}`, role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, email, password, auth: { authorization: `Bearer ${token}` } };
}

async function login(app: FastifyInstance, email: string, password: string): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { authorization: `Bearer ${token}` };
}

describe('Advanced Roles — Operations Manager sees address issues exist, never the literal address', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let shipmentId: string;
  let opsUserId: string;
  let opsAuth: Record<string, string>;
  let logisticsUserId: string;
  let logisticsAuth: Record<string, string>;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `Privacy Brand ${Date.now()}` } }));
    const campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `Privacy Camp ${Date.now()}` } }));
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `Privacy Creator ${Date.now()}`, countryCode: 'KW' } }),
    );
    const ciId = idOf(
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
          recipientName: 'Privacy Recipient',
          phone: '+96555512345',
          addressLine1: 'Very Specific Street 99',
          city: 'Kuwait City',
          destinationCountryCode: 'KW',
          items: [{ productName: 'Kit' }],
        },
      }),
    );

    const ops = await createStaff(app, 'ops');
    opsUserId = ops.userId;
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${opsUserId}`, headers: admin, payload: { roleProfile: 'OPERATIONS_MANAGER' } });
    opsAuth = await login(app, ops.email, ops.password);

    const logistics = await createStaff(app, 'log');
    logisticsUserId = logistics.userId;
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${logisticsUserId}`, headers: admin, payload: { roleProfile: 'LOGISTICS' } });
    logisticsAuth = await login(app, logistics.email, logistics.password);
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(opsUserId);
    await deleteUser(logisticsUserId);
  });

  it("an Operations Manager's direct GET sees the shipment (status/addressHealth) but never the address or phone", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: opsAuth });
    expect(res.statusCode).toBe(200);
    const shipment = res.json() as ProductShipmentDTO;
    expect(shipment.status).toBe('PENDING');
    expect(shipment.addressHealth).toBe('COMPLETE');
    expect(shipment.phone).toBeNull();
    expect(shipment.addressLine1).toBeNull();
  });

  it("an Operations Manager's /logistics workspace list also redacts the address, without hiding the row itself", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/shipments', headers: opsAuth });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { data: LogisticsRequestDTO[] };
    const row = list.data.find((s) => s.id === shipmentId);
    expect(row).toBeDefined();
    expect(row!.addressLine1).toBeNull();
    expect(row!.phone).toBeNull();
  });

  it('a Logistics operator (holds LOGISTICS_ADDRESS_VIEW) sees the full address — they need it to fulfil the shipment', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: logisticsAuth });
    expect(res.statusCode).toBe(200);
    const shipment = res.json() as ProductShipmentDTO;
    expect(shipment.addressLine1).toBe('Very Specific Street 99');
    expect(shipment.phone).toBe('+96555512345');
  });

  it('an explicit capability override lets one Operations Manager see the address without changing the Role Profile default for everyone else — takes effect immediately, no re-login required (capabilities are resolved fresh per request, never baked into the token)', async () => {
    const overrideRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${opsUserId}/capabilities`,
      headers: admin,
      payload: { overrides: [{ capability: 'LOGISTICS_ADDRESS_VIEW', granted: true }] },
    });
    expect(overrideRes.statusCode).toBe(204);
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: opsAuth });
    const shipment = res.json() as ProductShipmentDTO;
    expect(shipment.addressLine1).toBe('Very Specific Street 99');
  });
});
