import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P2.8 — list controls: the creator directory sorts by name, newest or last
 * updated and filters by owner ("mine", "nobody"); the campaign list sorts
 * and filters to "my campaigns". Written against the typed API client.
 */
describe('P2.8 — directory sort and owner filters (typed client)', () => {
  let app: FastifyInstance;
  let adminId: string;
  let api: Awaited<ReturnType<typeof clientFor>>;
  let prisma: import('@influenceos/database').PrismaClient;
  const tag = `P28${Date.now()}`;
  let brandId: string;
  const influencerIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminId = a.userId;
    api = await clientFor(app, a.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (await prisma.brand.create({ data: { name: `${tag} Brand`, slug: tag.toLowerCase() } })).id;
    // Created in the order C, A, B; A is owned by the admin.
    for (const [name, owned] of [['Charlie', false], ['Alpha', true], ['Bravo', false]] as const) {
      const i = await prisma.influencer.create({
        data: { displayName: `${tag} ${name}`, countryCode: 'KW', ownerId: owned ? adminId : null },
      });
      influencerIds.push(i.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    for (const [name, owned, start] of [
      ['Zulu', true, '2030-05-01'],
      ['Yankee', false, '2030-03-01'],
    ] as const) {
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} ${name}`,
          slug: `${tag.toLowerCase()}-${name.toLowerCase()}`,
          status: 'PLANNING',
          startDate: new Date(`${start}T09:00:00+03:00`),
          ownerId: owned ? adminId : null,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { brandId } });
    await prisma.influencer.deleteMany({ where: { id: { in: influencerIds } } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  const names = (rows: { displayName?: string; name?: string }[]) => rows.map((r) => (r.displayName ?? r.name)!.replace(`${tag} `, ''));

  it('creators: newest first by default, then by name either way, then last updated', async () => {
    expect(names((await api.influencers.list({ q: tag })).data)).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(names((await api.influencers.list({ q: tag, sort: 'name', order: 'asc' })).data)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(names((await api.influencers.list({ q: tag, sort: 'name', order: 'desc' })).data)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    await prisma.influencer.update({ where: { id: influencerIds[0]! }, data: { city: 'Salmiya' } });
    expect(names((await api.influencers.list({ q: tag, sort: 'updatedAt', order: 'desc' })).data)[0]).toBe('Charlie');
  });

  it('creators: owned by me, and owned by nobody', async () => {
    expect(names((await api.influencers.list({ q: tag, ownerId: adminId })).data)).toEqual(['Alpha']);
    expect(names((await api.influencers.list({ q: tag, ownerId: 'unowned', sort: 'name', order: 'asc' })).data)).toEqual(['Bravo', 'Charlie']);
  });

  it('campaigns: my campaigns, and sorted by start date', async () => {
    expect(names((await api.campaigns.list({ brandId, ownerId: adminId })).data)).toEqual(['Zulu']);
    expect(names((await api.campaigns.list({ brandId, sort: 'startDate', order: 'asc' })).data)).toEqual(['Yankee', 'Zulu']);
  });

  it('a bad value comes back as a typed validation error', async () => {
    const err = await api.influencers.list({ minFollowers: -5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
  });
});
