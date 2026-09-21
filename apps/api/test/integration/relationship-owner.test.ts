import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { generateNotifications } from '../../../worker/src/processors.ts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W4-5 — relationship owner / assignee + reminder routing. An influencer can be
 * assigned an owner, and a campaign's deliverable reminders are routed to the
 * campaign owner so the accountable person is the one pinged.
 */
describe('W4-5 — relationship owner + reminder routing', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let ownerId: string; // the admin user acts as the owner
  let brandId: string;
  let campaignId: string;
  let prisma: import('@influenceos/database').PrismaClient;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const day = 864e5;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    ownerId = a.userId;
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Owner Brand ${Date.now()}` } }));
  });

  afterAll(async () => {
    if (campaignId) await prisma.notification.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: 'Owned Creator' } } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(ownerId);
  });

  it('assigns and reads back an influencer owner', async () => {
    const created = idOf(await app.inject({
      method: 'POST', url: '/api/v1/influencers', headers: auth,
      payload: { displayName: `Owned Creator ${Date.now()}`, ownerId, countryCode: 'KW' },
    }));
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${created}`, headers: auth })).json() as InfluencerDetailDTO;
    expect(detail.ownerId).toBe(ownerId);
    expect(detail.ownerName).not.toBeNull();

    // Clearing the owner works.
    const cleared = (await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${created}`, headers: auth, payload: { ownerId: null } })).json() as InfluencerDetailDTO;
    expect(cleared.ownerId).toBeNull();
  });

  it('routes a deliverable reminder to the campaign owner', async () => {
    // A campaign owned by our user, with a deliverable due within 48h.
    const influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Owned Creator R ${Date.now()}`, countryCode: 'KW' } }));
    const campaign = await prisma.campaign.create({
      data: { brandId, name: `Owned Camp ${Date.now()}`, slug: `owned-${Date.now()}`, ownerId },
      select: { id: true },
    });
    campaignId = campaign.id;
    const ci = await prisma.campaignInfluencer.create({ data: { campaignId, influencerId }, select: { id: true } });
    await prisma.deliverable.create({
      data: { campaignInfluencerId: ci.id, platform: 'INSTAGRAM', type: 'REEL', status: 'PLANNED', dueDate: new Date(Date.now() + day) },
    });

    await generateNotifications();

    const notif = await prisma.notification.findFirst({
      where: { category: 'DELIVERABLE_DUE_SOON', campaignId },
      select: { userId: true },
    });
    expect(notif).not.toBeNull();
    // The reminder is targeted at the campaign owner, not a broadcast.
    expect(notif!.userId).toBe(ownerId);
  });
});
