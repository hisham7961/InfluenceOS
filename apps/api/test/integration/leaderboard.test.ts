import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreatorLeaderboardDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W6-2 — server-computed creator performance leaderboard. Ranks committed
 * creators by delivered work (no browser math), with tier + repeat-collaboration
 * signal, so the strongest and weakest creators are answerable.
 */
describe('W6-2 — creator performance leaderboard', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let strong: string; // delivers a lot, twice
  let weak: string; // committed, delivers nothing
  let invitedOnly: string; // never committed → must not appear

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  async function addRoster(campaignId: string, influencerId: string, status: string): Promise<string> {
    const ci = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId, dealType: 'FREE' } }));
    await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ci}`, headers: auth, payload: { participationStatus: status } });
    return ci;
  }

  async function addPublishedDeliverable(ciId: string): Promise<void> {
    const d = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciId}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'REEL' } }));
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${d}`, headers: auth, payload: { status: 'PUBLISHED' } });
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `LB Brand ${Date.now()}` } }));
    strong = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Strong ${Date.now()}` } }));
    weak = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Weak ${Date.now()}` } }));
    invitedOnly = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Invited ${Date.now()}` } }));

    // Two committed campaigns for the strong creator, each with published work.
    const c1 = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `LB C1 ${Date.now()}` } }));
    const c2 = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `LB C2 ${Date.now()}` } }));
    const s1 = await addRoster(c1, strong, 'COMPLETED');
    const s2 = await addRoster(c2, strong, 'COMPLETED');
    await addPublishedDeliverable(s1);
    await addPublishedDeliverable(s2);
    // Weak: committed once, no published deliverables.
    await addRoster(c1, weak, 'CONFIRMED');
    // Invited-only: never committed → excluded.
    const iv = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${c1}/influencers`, headers: auth, payload: { influencerId: invitedOnly, dealType: 'FREE' } }));
    expect(iv).toBeTruthy();
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    for (const id of [strong, weak, invitedOnly]) await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('ranks the strong creator first with a repeat-collaboration signal and tier', async () => {
    const board = (await app.inject({ method: 'GET', url: `/api/v1/reports/leaderboard?brandId=${brandId}`, headers: auth })).json() as CreatorLeaderboardDTO;
    const ids = board.entries.map((e) => e.influencerId);

    // Invited-only creator never committed → not on the board.
    expect(ids).not.toContain(invitedOnly);
    // The strong creator outranks the weak one.
    expect(ids.indexOf(strong)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(strong)).toBeLessThan(ids.indexOf(weak));

    const s = board.entries.find((e) => e.influencerId === strong)!;
    expect(s.campaigns).toBe(2);
    expect(s.repeatCollaborations).toBe(1);
    expect(s.deliverablesPublished).toBe(2);
    expect(s.completionRate).toBe(1);
    expect(s.tier).toBe('BRONZE'); // 2 published < 3
    expect(s.score).toBeGreaterThan(0);

    const w = board.entries.find((e) => e.influencerId === weak)!;
    expect(w.campaigns).toBe(1);
    expect(w.repeatCollaborations).toBe(0);
    expect(w.deliverablesPublished).toBe(0);
    expect(w.completionRate).toBeNull(); // no deliverables at all
    expect(w.tier).toBe('NEW');
    expect(s.score).toBeGreaterThan(w.score);
  });

  it('respects the limit', async () => {
    const board = (await app.inject({ method: 'GET', url: `/api/v1/reports/leaderboard?brandId=${brandId}&limit=1`, headers: auth })).json() as CreatorLeaderboardDTO;
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]!.influencerId).toBe(strong);
  });
});
