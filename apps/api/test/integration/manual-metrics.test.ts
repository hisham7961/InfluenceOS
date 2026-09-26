import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ContentMetricsDTO, PublishedContentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P1.1 — Snapchat, TikTok and Stories have no metrics API, so their numbers
 * are typed in. An entry can carry the date the numbers were read (an old
 * insights screenshot), and a whole campaign can be filled in one go.
 */
describe('P1.1 — manual metrics entry', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let influencerId: string;
  let postA: string;
  let postB: string;
  let postOther: string;
  const tag = `MM${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  const post = (url: string, campaign: string) =>
    app
      .inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url, campaignId: campaign, influencerId } })
      .then(idOf);

  beforeAll(async () => {
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `${tag} Brand` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `${tag} A` } }));
    otherCampaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `${tag} B` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${tag} Creator`, countryCode: 'KW' } }));
    for (const c of [campaignId, otherCampaignId]) {
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${c}/influencers`, headers: auth, payload: { influencerId, dealType: 'FREE' } });
    }
    postA = await post(`https://www.snapchat.com/spotlight/${tag}A`, campaignId);
    postB = await post(`https://www.snapchat.com/spotlight/${tag}B`, campaignId);
    postOther = await post(`https://www.snapchat.com/spotlight/${tag}C`, otherCampaignId);
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(userId);
  });

  const detail = async (id: string) =>
    (await app.inject({ method: 'GET', url: `/api/v1/content/${id}`, headers: auth })).json() as PublishedContentDTO;

  it('records typed-in numbers as the latest metrics', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/content/${postA}/metrics`,
      headers: auth,
      payload: { views: 12000, likes: 800, comments: 40 },
    });
    expect(res.statusCode).toBe(200);
    const c = await detail(postA);
    expect(c.metrics?.views).toBe(12000);
    expect(c.metrics?.source).toBe('MANUAL');
    expect(c.lastMetricsSyncAt).not.toBeNull();
  });

  it('keeps back-dated numbers in the history without making them the latest', async () => {
    const lastWeek = new Date(Date.now() - 7 * 864e5).toISOString();
    await app.inject({
      method: 'POST',
      url: `/api/v1/content/${postA}/metrics`,
      headers: auth,
      payload: { views: 3000, capturedAt: lastWeek },
    });
    const c = await detail(postA);
    expect(c.metrics?.views).toBe(12000);
    const history = (await app.inject({ method: 'GET', url: `/api/v1/content/${postA}/metrics`, headers: auth })).json() as ContentMetricsDTO[];
    expect(history.map((h) => h.views)).toEqual([3000, 12000]);
    expect(history[0]!.capturedAt).toBe(lastWeek);
  });

  it('refuses a date in the future', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/content/${postA}/metrics`,
      headers: auth,
      payload: { views: 1, capturedAt: new Date(Date.now() + 5 * 864e5).toISOString() },
    });
    expect(res.statusCode).toBe(422);
  });

  it('fills a whole campaign at once, skipping empty rows', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/content-metrics`,
      headers: auth,
      payload: {
        entries: [
          { contentId: postA, views: 15000, likes: 900 },
          { contentId: postB, views: 4000, shares: 12 },
          { contentId: postB, views: null },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recorded: 2, skipped: 1 });
    expect((await detail(postA)).metrics?.views).toBe(15000);
    expect((await detail(postB)).metrics?.shares).toBe(12);
  });

  it('lists posts that still have no numbers (the wall\'s "No metrics" chip)', async () => {
    const missing = async (campaign: string) =>
      (
        (await app.inject({ method: 'GET', url: `/api/v1/content/feed?campaignId=${campaign}&metrics=missing`, headers: auth })).json() as {
          data: { id: string }[];
        }
      ).data.map((d) => d.id);
    expect(await missing(otherCampaignId)).toEqual([postOther]);
    expect(await missing(campaignId)).toEqual([]);
    const summary = (await app.inject({ method: 'GET', url: '/api/v1/content/summary', headers: auth })).json() as {
      missingMetrics: number;
    };
    expect(summary.missingMetrics).toBeGreaterThanOrEqual(1);
  });

  it("rejects a post that isn't part of the campaign, writing nothing", async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/content-metrics`,
      headers: auth,
      payload: { entries: [{ contentId: postB, views: 99 }, { contentId: postOther, views: 1 }] },
    });
    expect(res.statusCode).toBe(404);
    expect((await detail(postB)).metrics?.views).toBe(4000);
    expect((await detail(postOther)).metrics).toBeNull();
  });
});
