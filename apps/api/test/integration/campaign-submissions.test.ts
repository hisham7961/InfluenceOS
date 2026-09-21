import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DeliverableSubmissionDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-1 (web surface) — the campaign-level submission review queue returns every
 * submission across the campaign's deliverables in one query, so the workspace
 * can show "what's waiting on me?" without walking each deliverable.
 */
describe('W3-1 — campaign submission review queue', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let deliverableId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Sub Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Sub Camp ${Date.now()}` } }));
    const inf = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Sub Inf ${Date.now()}`, countryCode: 'KW' } }));
    const ci = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: inf, dealType: 'FREE' } }));
    deliverableId = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ci}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'REEL' } }));
    await app.inject({ method: 'POST', url: `/api/v1/deliverables/${deliverableId}/submissions`, headers: auth, payload: { notes: 'First draft', assetUrl: 'https://drive.example.com/asset1' } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: 'Sub Inf ' } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('lists submissions across the campaign with deliverable + version context', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/submissions`, headers: auth })).json() as DeliverableSubmissionDTO[];
    expect(list).toHaveLength(1);
    const s = list[0]!;
    expect(s.deliverableId).toBe(deliverableId);
    expect(s.version).toBe(1);
    expect(s.notes).toBe('First draft');
    expect(s.submittedByName).toBeTruthy();
    expect(typeof s.status).toBe('string');
  });

  it('returns an empty array for a campaign with no submissions', async () => {
    const empty = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Sub Empty ${Date.now()}` } }));
    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${empty}/submissions`, headers: auth })).json() as DeliverableSubmissionDTO[];
    expect(list).toEqual([]);
  });
});
