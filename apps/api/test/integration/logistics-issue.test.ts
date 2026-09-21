import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LogisticsIssueDTO, LogisticsRequestDTO, NotificationDTO, ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Advanced Roles & Logistics Operations pass — the Address Clarification
 * workflow. A shipment keeps its real (often still PENDING) ShipmentStatus
 * while an OPEN LogisticsIssue is the actual blocker; resolving it is
 * available to the responsible employee even without the broad
 * LOGISTICS_ISSUE_MANAGE capability (ownership-based override); the
 * notification never carries the actual address in its body; and country
 * scope is enforced server-side on both the list and direct-by-id paths.
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
  const user = await prisma.user.create({
    data: { email, name: `Staff ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const auth = await login(app, email, password);
  return { userId: user.id, email, password, auth };
}

async function login(app: FastifyInstance, email: string, password: string): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { authorization: `Bearer ${token}` };
}

describe('Advanced Roles — Address Clarification workflow', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let campaignOwnerId: string;
  let campaignOwnerAuth: Record<string, string>;
  let bystanderId: string;
  let bystanderAuth: Record<string, string>;
  let bystanderEmail: string;
  let bystanderPassword: string;
  let brandId: string;
  let campaignId: string;
  let ciId: string;
  let shipmentId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    ({ userId: campaignOwnerId, auth: campaignOwnerAuth } = await createStaff(app, 'owner'));
    ({ userId: bystanderId, auth: bystanderAuth, email: bystanderEmail, password: bystanderPassword } = await createStaff(app, 'bystander'));

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `LogIssue Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: admin,
        payload: { brandId, name: `LogIssue Camp ${Date.now()}`, ownerId: campaignOwnerId },
      }),
    );
    const influencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: { displayName: `LogIssue Creator ${Date.now()}` },
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
    // Deliberately missing phone — an incomplete address.
    shipmentId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: admin,
        payload: { recipientName: 'Sara Creator', addressLine1: 'Street 1', city: 'Riyadh', destinationCountryCode: 'SA', items: [{ productName: 'Kit' }] },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(campaignOwnerId);
    await deleteUser(bystanderId);
  });

  it('create() picks the campaign owner as the responsible employee, notifies them (no address in the body), and the shipment reflects the block', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/shipments/${shipmentId}/issues`,
      headers: admin,
      payload: { type: 'MISSING_PHONE', description: 'Phone number is unreachable — please confirm.' },
    });
    expect(res.statusCode).toBe(200);
    const issue = res.json() as LogisticsIssueDTO;
    expect(issue.status).toBe('OPEN');
    expect(issue.assignedToUserId).toBe(campaignOwnerId);

    const shipment = (await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: admin })).json() as ProductShipmentDTO;
    expect(shipment.addressHealth).toBe('CLARIFICATION_REQUESTED');
    expect(shipment.openIssue?.id).toBe(issue.id);
    // ShipmentStatus itself is untouched by the issue — still whatever it was (PENDING).
    expect(shipment.status).toBe('PENDING');

    const notifications = (
      await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: campaignOwnerAuth })
    ).json() as { data: NotificationDTO[] };
    const mine = notifications.data.find((n) => n.category === 'LOGISTICS_ADDRESS_ISSUE');
    expect(mine).toBeDefined();
    expect(mine!.body ?? '').not.toContain('Street 1');
    expect(mine!.body ?? '').not.toContain('+965'); // no phone number either
  });

  it('resolve() is refused for someone who is neither the responsible employee nor logistics', async () => {
    // A narrower Role Profile than legacy STAFF (which defaults to broad
    // backward-compatible access) — Influencer Manager genuinely lacks
    // LOGISTICS_ISSUE_MANAGE by default, and is not this issue's responsible party.
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${bystanderId}`, headers: admin, payload: { roleProfile: 'INFLUENCER_MANAGER' } });
    // A role/profile change revokes existing sessions (SEC-03) — get a fresh token.
    bystanderAuth = await login(app, bystanderEmail, bystanderPassword);
    const res = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${await currentOpenIssueId()}/resolve`, headers: bystanderAuth });
    expect(res.statusCode).toBe(403);
  });

  it("resolve() succeeds for the responsible employee via the ownership override (no LOGISTICS_ISSUE_MANAGE capability needed), and addressHealth becomes Resolved once the address is complete", async () => {
    // The responsible employee fixes the address first (a real, separate PATCH — resolving never silently rewrites the shipment on its own).
    await app.inject({ method: 'PATCH', url: `/api/v1/shipments/${shipmentId}`, headers: campaignOwnerAuth, payload: { phone: '+96550000000' } });

    const issueId = await currentOpenIssueId();
    const res = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${issueId}/resolve`, headers: campaignOwnerAuth });
    expect(res.statusCode).toBe(200);
    const issue = res.json() as LogisticsIssueDTO;
    expect(issue.status).toBe('RESOLVED');
    expect(issue.resolvedById).toBe(campaignOwnerId);

    const shipment = (await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: admin })).json() as ProductShipmentDTO;
    expect(shipment.openIssue).toBeNull();
    expect(shipment.addressHealth).toBe('RESOLVED');
  });

  async function currentOpenIssueId(): Promise<string> {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}/issues`, headers: admin })).json() as LogisticsIssueDTO[];
    const open = list.find((i) => i.status === 'OPEN');
    if (!open) throw new Error('expected an OPEN issue to exist for this test');
    return open.id;
  }

  it('assign()/unassign the logistics operator responsible for fulfilment, distinct from the requester', async () => {
    const assign = await app.inject({ method: 'POST', url: `/api/v1/shipments/${shipmentId}/assign`, headers: admin, payload: { userId: bystanderId } });
    expect(assign.statusCode).toBe(200);
    let shipment = assign.json() as ProductShipmentDTO;
    expect(shipment.assignedToUserId).toBe(bystanderId);
    expect(shipment.assignedToName).toBeTruthy();
    expect(shipment.createdById).toBe(adminId); // the requester, untouched by assignment

    const unassign = await app.inject({ method: 'POST', url: `/api/v1/shipments/${shipmentId}/assign`, headers: admin, payload: { userId: null } });
    shipment = unassign.json() as ProductShipmentDTO;
    expect(shipment.assignedToUserId).toBeNull();
  });

  it('is country-scoped server-side — a KW-only Logistics operator neither lists nor directly loads a Saudi-destination shipment', async () => {
    const { userId: kwUserId, email: kwEmail, password: kwPassword } = await createStaff(app, 'kw-logistics');
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${kwUserId}`, headers: admin, payload: { roleProfile: 'LOGISTICS' } });
    await app.inject({ method: 'PUT', url: `/api/v1/users/${kwUserId}/country-access`, headers: admin, payload: { countryCodes: ['KW'] } });
    // The roleProfile PATCH above revoked the login obtained inside createStaff (SEC-03) — get a fresh token that reflects the new scope.
    const kwAuth = await login(app, kwEmail, kwPassword);

    const list = (await app.inject({ method: 'GET', url: '/api/v1/shipments', headers: kwAuth })).json() as { data: LogisticsRequestDTO[] };
    expect(list.data.some((s) => s.id === shipmentId)).toBe(false);

    const direct = await app.inject({ method: 'GET', url: `/api/v1/shipments/${shipmentId}`, headers: kwAuth });
    expect(direct.statusCode).toBe(404);

    await deleteUser(kwUserId);
  });
});
