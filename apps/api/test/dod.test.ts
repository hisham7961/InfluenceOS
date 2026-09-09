import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from './helpers.ts';

/**
 * Definition-of-Done scenario (spec §DoD) exercised end-to-end through the real
 * HTTP API — the exact operator journey:
 *   pick brand → resolve a profile (manual fallback, no API key) → create
 *   influencer + social account → create campaign → add PAID + FREE
 *   influencers → add deliverable + script → paste the published content URL →
 *   see it flow into the feed, auto-publish the deliverable, advance campaign
 *   progress, and surface in the global "What's New".
 *
 * Fully self-contained: it provisions its own admin, brand and influencers so
 * it never depends on demo seed data, and cleans up after itself.
 */
describe('DoD — full campaign lifecycle through the API', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const created = { brandId: '', campaignId: '', influencerIds: [] as string[], contentId: '' };

  beforeAll(async () => {
    app = await makeApp();
    const s = await loginFresh(app);
    auth = s.auth;
    userId = s.userId;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    if (created.campaignId) await prisma.campaign.delete({ where: { id: created.campaignId } }).catch(() => undefined);
    for (const id of created.influencerIds) await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    if (created.brandId) await prisma.brand.delete({ where: { id: created.brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  async function call<T = any>(method: any, url: string, payload?: unknown): Promise<T> {
    const r = await app.inject({ method, url, headers: { ...auth, 'content-type': 'application/json' }, payload });
    if (r.statusCode >= 400) throw new Error(`${method} ${url} -> ${r.statusCode} ${r.body}`);
    return r.json() as T;
  }

  it('drives a campaign from profile resolution to published content', async () => {
    const stamp = Date.now();

    // 1. Brand
    const brand = await call('POST', '/api/v1/brands', { name: `DoD Brand ${stamp}` });
    created.brandId = brand.id;

    // 2. Resolve a profile URL via the manual fallback (no provider API key)
    const handle = `dodcreator${stamp}`;
    const resolved = await call('POST', '/api/v1/influencers/resolve', {
      input: `https://www.youtube.com/@${handle}`,
    });
    expect(resolved.platform).toBe('YOUTUBE');

    // ...and create the influencer + primary social account
    const inf = await call('POST', '/api/v1/influencers', { displayName: 'DoD Creator', category: 'Tech', country: 'Kuwait' });
    created.influencerIds.push(inf.id);
    await call('POST', `/api/v1/influencers/${inf.id}/social-accounts`, {
      platform: resolved.platform,
      username: resolved.username ?? handle,
      followers: 123000,
      isPrimary: true,
    });

    const freeInf = await call('POST', '/api/v1/influencers', { displayName: 'DoD Gifted Creator', category: 'Lifestyle' });
    created.influencerIds.push(freeInf.id);

    // 3. Campaign
    const camp = await call('POST', '/api/v1/campaigns', {
      brandId: brand.id,
      name: `DoD Verification Campaign ${stamp}`,
      status: 'ACTIVE',
      startDate: new Date().toISOString(),
      endDate: new Date(stamp + 20 * 864e5).toISOString(),
      plannedBudget: 5000,
    });
    created.campaignId = camp.id;

    // 4. Add influencers — one PAID, one FREE
    const ci = await call('POST', `/api/v1/campaigns/${camp.id}/influencers`, {
      influencerId: inf.id,
      dealType: 'PAID',
      agreedCost: 800,
      paymentStatus: 'UNPAID',
    });
    await call('POST', `/api/v1/campaigns/${camp.id}/influencers`, { influencerId: freeInf.id, dealType: 'FREE' });

    // 5. Deliverable + script
    const deliverable = await call('POST', `/api/v1/campaign-influencers/${ci.id}/deliverables`, {
      platform: 'YOUTUBE',
      type: 'VIDEO',
      dueDate: new Date(stamp + 3 * 864e5).toISOString(),
    });
    await call('POST', '/api/v1/scripts', {
      campaignId: camp.id,
      deliverableId: deliverable.id,
      title: 'DoD brief',
      body: 'Show the product.',
      dos: ['Disclose #ad'],
      donts: ['No competitors'],
    });

    // 6. Progress BEFORE publishing
    const before = await call('GET', `/api/v1/campaigns/${camp.id}`);

    // 7. Paste the published content URL, linked to the deliverable.
    //    A unique 11-char video id keeps the canonicalized URL distinct per run
    //    (the API dedupes by canonical URL, so a cache-buster query won't do).
    const videoId = (stamp.toString(36) + 'zzzzzzzzzzz').slice(0, 11);
    const content = await call('POST', '/api/v1/content', {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      campaignId: camp.id,
      deliverableId: deliverable.id,
    });
    created.contentId = content.id;
    expect(content.platform).toBe('YOUTUBE');
    expect(content.embeddable).toBe(true);

    // 8. It flows everywhere it should
    const feed = await call('GET', `/api/v1/content/feed?campaignId=${camp.id}`);
    const after = await call('GET', `/api/v1/campaigns/${camp.id}`);
    const cis = await call('GET', `/api/v1/campaigns/${camp.id}/influencers`);
    const dash = await call('GET', '/api/v1/dashboard/global');

    expect(feed.data.some((c: any) => c.id === content.id)).toBe(true);
    expect(
      cis.flatMap((c: any) => c.deliverables).some((d: any) => d.id === deliverable.id && d.status === 'PUBLISHED'),
    ).toBe(true);
    expect(after.progress.deliverablesPublished).toBeGreaterThan(before.progress.deliverablesPublished);
    expect(dash.whatsNew.some((w: any) => w.content?.id === content.id)).toBe(true);
  });
});
