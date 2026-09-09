import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BrandDetailDTO, CampaignSummaryDTO, Paginated } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Brand isolation (item 74): brand-scoped queries must return ONLY that brand's
 * data. Two brands, each with a campaign; a brand-scoped list/detail for one
 * must never surface the other's records. (The global admin list may aggregate
 * — that is intentional and not tested here.)
 */
describe('brand isolation — scoped queries do not leak across brands', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const created: { brands: string[]; campaigns: string[] } = { brands: [], campaigns: [] };

  beforeAll(async () => {
    app = await makeApp();
    const s = await loginFresh(app);
    auth = s.auth;
    userId = s.userId;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    for (const id of created.campaigns) await prisma.campaign.delete({ where: { id } }).catch(() => undefined);
    for (const id of created.brands) await prisma.brand.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  async function makeBrand(name: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name } });
    const id = (res.json() as { id: string }).id;
    created.brands.push(id);
    return id;
  }
  async function makeCampaign(brandId: string, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: auth,
      payload: { brandId, name, status: 'ACTIVE' },
    });
    const id = (res.json() as { id: string }).id;
    created.campaigns.push(id);
    return id;
  }

  it('a brand-scoped campaign list returns only that brand’s campaigns', async () => {
    const stamp = Date.now();
    const brandA = await makeBrand(`Iso A ${stamp}`);
    const brandB = await makeBrand(`Iso B ${stamp}`);
    const campA = await makeCampaign(brandA, `A camp ${stamp}`);
    const campB = await makeCampaign(brandB, `B camp ${stamp}`);

    const listA = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns?brandId=${brandA}&limit=100`, headers: auth })
    ).json() as Paginated<CampaignSummaryDTO>;
    const idsA = listA.data.map((c) => c.id);
    expect(idsA).toContain(campA);
    expect(idsA).not.toContain(campB); // brand B's campaign must not leak into brand A's list

    const listB = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns?brandId=${brandB}&limit=100`, headers: auth })
    ).json() as Paginated<CampaignSummaryDTO>;
    const idsB = listB.data.map((c) => c.id);
    expect(idsB).toContain(campB);
    expect(idsB).not.toContain(campA);
  });

  it('brand detail stats count only that brand’s campaigns', async () => {
    const stamp = Date.now();
    const brandA = await makeBrand(`Iso C ${stamp}`);
    const brandB = await makeBrand(`Iso D ${stamp}`);
    await makeCampaign(brandA, `C camp1 ${stamp}`);
    await makeCampaign(brandA, `C camp2 ${stamp}`);
    await makeCampaign(brandB, `D camp1 ${stamp}`);

    const detailA = (await app.inject({ method: 'GET', url: `/api/v1/brands/${brandA}`, headers: auth })).json() as BrandDetailDTO;
    // Exactly the two campaigns created for brand A — B's campaign is not counted.
    expect(detailA.stats.totalCampaigns).toBe(2);
    expect(detailA.stats.activeCampaigns).toBe(2);
  });
});
