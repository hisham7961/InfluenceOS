import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

async function loginStaff(app: FastifyInstance): Promise<{ auth: Record<string, string>; userId: string }> {
  const email = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { email, name: 'Scoped Staff', role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
  return { auth: { authorization: `Bearer ${tokens.accessToken}` }, userId: user.id };
}

/**
 * WORKFLOW_GAP_MATRIX.md, "Permissions/privacy" — a brand-scoped operator
 * cannot create, re-link, or otherwise reach content or logistics shipments
 * outside their brand access, even by referencing another brand's campaign/
 * deliverable id directly (see WF-14: resolveContentAssociation and
 * shipment.service.ts both check scope on every association change).
 */
describe('Permissions/privacy — content + logistics respect brand scope', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let staff: { auth: Record<string, string>; userId: string };
  let brandA: { id: string };
  let brandB: { id: string };
  let campaignA: string;
  let campaignB: string;
  let influencerId: string;
  let ciA: string;
  let ciB: string;

  const tag = `BS-${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminAuth = a.auth;
    adminId = a.userId;
    brandA = (await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `${tag} A` } })).json() as { id: string };
    brandB = (await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `${tag} B` } })).json() as { id: string };
    campaignA = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: adminAuth, payload: { brandId: brandA.id, name: `${tag} Camp A` } }));
    campaignB = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: adminAuth, payload: { brandId: brandB.id, name: `${tag} Camp B` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: adminAuth, payload: { displayName: `${tag} Sara` } }));
    ciA = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: adminAuth, payload: { influencerId, dealType: 'FREE' } }));
    ciB = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignB}/influencers`, headers: adminAuth, payload: { influencerId, dealType: 'FREE' } }));

    staff = await loginStaff(app);
    // Scope the staff user to brand A only.
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.userId}/brand-access`, headers: adminAuth, payload: { brandIds: [brandA.id] } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandA.id, brandB.id] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandA.id, brandB.id] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA.id, brandB.id] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await deleteUser(staff.userId);
    await deleteUser(adminId);
    await app.close();
  });

  it('a scoped staff user CAN create content in their own brand', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: staff.auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}A1`, campaignId: campaignA },
    });
    expect(res.statusCode).toBe(201);
  });

  it('a scoped staff user CANNOT create content in an out-of-scope brand via campaignId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: staff.auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}B1`, campaignId: campaignB },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a scoped staff user CANNOT create a shipment against an out-of-scope campaign-influencer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciB}/shipments`,
      headers: staff.auth,
      payload: { recipientName: 'Sara' },
    });
    expect(res.statusCode).toBe(404); // reads as not-found, same posture as brand.service.ts
  });

  it('a scoped staff user CAN create a shipment for their own brand', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciA}/shipments`,
      headers: staff.auth,
      payload: { recipientName: 'Sara' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('cannot reassign in-scope content to an out-of-scope campaign', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/content',
        headers: staff.auth,
        payload: { url: `https://www.youtube.com/watch?v=${tag}A2` },
      })
    ).json() as PublishedContentDTO;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/content/${created.id}`,
      headers: staff.auth,
      payload: { campaignId: campaignB },
    });
    expect(res.statusCode).toBe(403);
  });

  it("the /shipments logistics workspace only shows the scoped staff's own brand", async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/shipments', headers: staff.auth })).json() as {
      data: { id: string; campaignInfluencerId: string }[];
    };
    expect(list.data.every((s) => s.campaignInfluencerId !== ciB)).toBe(true);
  });
});
