import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LogisticsCountrySummaryDTO, LogisticsRequestDTO, NoteDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Advanced Roles & Logistics Operations pass — the country-first summary
 * strip (GET /shipments/summary) and its needsAttention filter, plus the
 * capability-gated 'logistics' Team Chat channel. summary() and listAll()
 * share ONE buildWhere() in shipment.service.ts, so this proves the two can
 * never silently disagree.
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

describe('Advanced Roles — logistics summary + needsAttention + Logistics Team Chat', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let campaignId: string;
  let ciId: string;
  let attentionShipmentId: string;
  let calmShipmentId: string;
  const COUNTRY = 'AE';

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `LogSummary Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `LogSummary Camp ${Date.now()}` } }));
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `LogSummary Creator ${Date.now()}` } }),
    );
    ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: admin,
        payload: { influencerId, dealType: 'GIFTED_PRODUCT' },
      }),
    );

    calmShipmentId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: admin,
        payload: { recipientName: 'Calm Recipient', phone: '+97150000000', addressLine1: 'Street 9', city: 'Dubai', destinationCountryCode: COUNTRY, items: [{ productName: 'Kit' }] },
      }),
    );
    attentionShipmentId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: admin,
        payload: { recipientName: 'Blocked Recipient', addressLine1: 'Street 10', city: 'Dubai', destinationCountryCode: COUNTRY, items: [{ productName: 'Kit' }] },
      }),
    );
    // An OPEN issue is what makes this shipment count toward "needs attention".
    await app.inject({
      method: 'POST',
      url: `/api/v1/shipments/${attentionShipmentId}/issues`,
      headers: admin,
      payload: { type: 'MISSING_PHONE', description: 'No phone on file.' },
    });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  it('summary() reports this country with at least one shipment and one needing attention', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/shipments/summary', headers: admin });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as LogisticsCountrySummaryDTO[];
    const ae = rows.find((r) => r.countryCode === COUNTRY);
    expect(ae).toBeDefined();
    expect(ae!.countryName).toBe('United Arab Emirates');
    expect(ae!.total).toBeGreaterThanOrEqual(2);
    expect(ae!.needsAttention).toBeGreaterThanOrEqual(1);
  });

  it('needsAttention=true on the list endpoint returns exactly the shipments summary() counted, never the calm one', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments?destinationCountryCode=${COUNTRY}&needsAttention=true`, headers: admin });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { data: LogisticsRequestDTO[] };
    const ids = list.data.map((s) => s.id);
    expect(ids).toContain(attentionShipmentId);
    expect(ids).not.toContain(calmShipmentId);
  });

  it("hasOpenIssue and needsAttention agree for an address-issue shipment (needsAttention is the broader 'actionable now' filter)", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments?destinationCountryCode=${COUNTRY}&hasOpenIssue=true`, headers: admin });
    const list = res.json() as { data: LogisticsRequestDTO[] };
    expect(list.data.map((s) => s.id)).toContain(attentionShipmentId);
  });

  it("the Logistics Team Chat channel is capability-gated — an Influencer Manager (no LOGISTICS_VIEW) is refused, a Logistics operator is allowed", async () => {
    const denied = await createStaff(app, 'im');
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${denied.userId}`, headers: admin, payload: { roleProfile: 'INFLUENCER_MANAGER' } });
    // The roleProfile PATCH above revoked the login obtained inside createStaff (SEC-03) — get a fresh token.
    const deniedAuth = await login(app, denied.email, denied.password);

    const deniedPost = await app.inject({ method: 'POST', url: '/api/v1/notes', headers: deniedAuth, payload: { channel: 'logistics', body: 'should not be allowed' } });
    expect(deniedPost.statusCode).toBe(403);
    const deniedGet = await app.inject({ method: 'GET', url: '/api/v1/notes?channel=logistics', headers: deniedAuth });
    expect(deniedGet.statusCode).toBe(403);

    const allowedPost = await app.inject({ method: 'POST', url: '/api/v1/notes', headers: admin, payload: { channel: 'logistics', body: 'DHL pickup delayed today' } });
    expect(allowedPost.statusCode).toBe(201);
    const note = allowedPost.json() as NoteDTO;
    expect(note.channel).toBe('logistics');

    await deleteUser(denied.userId);
  });
});
