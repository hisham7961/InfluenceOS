import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignSummaryDTO, CursorPage, InfluencerSummaryDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W7-2 (PERF-04) — stable cursor pagination for the influencer and campaign
 * directories. Paging by keyset (createdAt desc, id desc) must cover every row
 * exactly once with no duplicates and no gaps, even when many rows share a
 * createdAt (they are created in a tight loop here).
 */
describe('W7-2 — stable cursor pagination', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  const token = `cur${Date.now()}`;
  const N = 5;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  async function pageAll<T extends { id: string }>(path: string): Promise<T[]> {
    const seen: T[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const url = `${path}&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await app.inject({ method: 'GET', url, headers: auth })).json() as CursorPage<T>;
      seen.push(...page.data);
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        return seen;
      }
      expect(page.data.length).toBe(2); // a non-final page is full
      expect(page.nextCursor).toBe(page.data[page.data.length - 1]!.id);
      cursor = page.nextCursor;
    }
    throw new Error('cursor paging did not terminate');
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Cursor Brand ${token}` } }));
    for (let i = 0; i < N; i += 1) {
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Cursor ${token} ${i}` } });
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Cursor Camp ${token} ${i}` } });
    }
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: token } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('influencer directory: cursor paging covers every row once, no duplicates', async () => {
    const all = await pageAll<InfluencerSummaryDTO>(`/api/v1/influencers/cursor?q=${token}`);
    const ids = all.map((r) => r.id);
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size).toBe(N); // no duplicates

    // Deterministic: the first page is identical on a re-fetch.
    const first = (await app.inject({ method: 'GET', url: `/api/v1/influencers/cursor?q=${token}&limit=2`, headers: auth })).json() as CursorPage<InfluencerSummaryDTO>;
    expect(first.data.map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(first.hasMore).toBe(true);
  });

  it('campaign directory: cursor paging covers every row once, no duplicates', async () => {
    const all = await pageAll<CampaignSummaryDTO>(`/api/v1/campaigns/cursor?brandId=${brandId}`);
    const ids = all.map((r) => r.id);
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size).toBe(N);
    // Every returned campaign belongs to the filtered brand (filter honoured).
    expect(all.every((c) => c.brandId === brandId)).toBe(true);
  });
});
