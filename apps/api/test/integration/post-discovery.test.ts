import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import type { RecentPost } from '@influenceos/shared';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.4 — post discovery: posts found on a roster creator's own account are
 * suggested for the running campaign (and a deliverable) only when the
 * caption carries the campaign's code, hashtags, mentions or brand; nothing
 * is tracked until someone adds it; a dismissed or already-tracked post is
 * never suggested again; scope and permissions apply. The platform read is
 * covered by the adapter unit tests — here posts are handed to `ingest`.
 */
describe('P3.4 — post discovery', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  let discovery: import('@influenceos/domain').DiscoveryService;
  const users: string[] = [];
  const tag = `P34${Date.now()}`;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let sara: string;
  let saraRow: string;
  let accountId: string;
  let reel: string;
  let story: string;

  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600e3).toISOString();
  const post = (id: string, caption: string | null, hoursAgo = 5): RecentPost => ({
    externalId: `${tag}${id}`,
    url: `https://www.instagram.com/p/${tag}${id}/`,
    postedAt: at(hoursAgo),
    caption,
    mediaType: 'IMAGE',
  });

  async function staff(
    label: string,
    roleProfile: 'OPERATIONS_MANAGER' | 'GENERAL_MANAGER',
    brands?: string[],
  ) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} ${label}`,
        role: 'STAFF',
        roleProfile,
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    for (const b of brands ?? [])
      await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: b } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 200;
    } catch (e) {
      if (e instanceof ApiError) return e.status;
      throw e;
    }
  };

  beforeAll(async () => {
    app = await makeApp();
    admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    const { createServices, systemContext } = await import('@influenceos/domain');
    discovery = createServices(systemContext()).discovery;

    brandId = (
      await prisma.brand.create({
        data: { name: `Lumiere${tag}`, slug: `${tag.toLowerCase()}-lumiere` },
      })
    ).id;
    otherBrandId = (
      await prisma.brand.create({
        data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-other` },
      })
    ).id;
    sara = (
      await prisma.influencer.create({ data: { displayName: `${tag} Sara`, countryCode: 'KW' } })
    ).id;
    accountId = (
      await prisma.socialAccount.create({
        data: { influencerId: sara, platform: 'INSTAGRAM', username: `${tag.toLowerCase()}sara` },
      })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Glow`,
          slug: `${tag.toLowerCase()}-glow`,
          status: 'ACTIVE',
          startDate: new Date(now - 10 * 86_400e3),
          endDate: new Date(now + 10 * 86_400e3),
        },
      })
    ).id;
    saraRow = (
      await prisma.campaignInfluencer.create({
        data: { campaignId, influencerId: sara, participationStatus: 'CONFIRMED' },
      })
    ).id;
    reel = (
      await prisma.deliverable.create({
        data: {
          campaignInfluencerId: saraRow,
          platform: 'INSTAGRAM',
          type: 'REEL',
          requiredHashtags: [`glow${tag}`],
          dueDate: new Date(now + 5 * 86_400e3),
        },
      })
    ).id;
    story = (
      await prisma.deliverable.create({
        data: {
          campaignInfluencerId: saraRow,
          platform: 'INSTAGRAM',
          type: 'STORY',
          dueDate: new Date(now + 2 * 86_400e3),
        },
      })
    ).id;
    await prisma.promoCode.create({
      data: {
        brandId,
        campaignId,
        influencerId: sara,
        code: `S${tag}`,
        codeKey: `S${tag}`,
        validFrom: new Date(now - 10 * 86_400e3),
      },
    });
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { campaignId } });
    await prisma.notification.deleteMany({ where: { campaignId } });
    await prisma.publishedContent.deleteMany({ where: { campaignId } });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: sara } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('suggests only posts that carry campaign signals, in the campaign window', async () => {
    const found = await discovery.ingest(accountId, [
      post('a', `New reel #glow${tag} ✨`),
      post('b', `Use S${tag} for 15% off`),
      post('c', 'Breakfast with friends'),
      post('d', `#glow${tag}`, 24 * 30), // before the campaign
      post('e', null),
    ]);
    expect(found).toBe(2);
    const list = await api.discovery.forCampaign(campaignId);
    const byId = new Map(list.map((p) => [p.url, p]));
    expect(byId.get(`https://www.instagram.com/p/${tag}a/`)).toMatchObject({
      status: 'NEW',
      signals: [`hashtag:#glow${tag.toLowerCase()}`],
      deliverable: { id: reel, type: 'REEL' },
      influencer: { id: sara },
    });
    expect(byId.get(`https://www.instagram.com/p/${tag}b/`)).toMatchObject({
      signals: [`code:S${tag}`],
      deliverable: { id: story },
    });
    const n = await prisma.notification.findFirst({
      where: { campaignId, title: 'New posts found for a campaign' },
    });
    expect(n?.body).toBe(`2 new posts from ${tag} Sara may belong to ${tag} Glow.`);
    expect(n?.targetUrl).toBe(`/campaigns/${campaignId}?tab=content`);

    // Seen once, never suggested twice.
    expect(await discovery.ingest(accountId, [post('a', `New reel #glow${tag}`)])).toBe(0);
  });

  it('adds a suggestion as tracked content on the chosen deliverable; dismisses another for good', async () => {
    const list = await api.discovery.forCampaign(campaignId);
    const a = list.find((p) => p.url.endsWith(`${tag}a/`))!;
    const b = list.find((p) => p.url.endsWith(`${tag}b/`))!;

    const added = await api.discovery.add(a.id, { deliverableId: story });
    expect(added).toMatchObject({ status: 'ADDED', deliverable: { id: story } });
    const content = await prisma.publishedContent.findUniqueOrThrow({
      where: { id: added.publishedContentId! },
    });
    expect(content).toMatchObject({ campaignId, influencerId: sara, deliverableId: story });
    expect(await status(api.discovery.add(a.id, {}))).toBe(409);

    const dismissed = await api.discovery.dismiss(b.id);
    expect(dismissed.status).toBe('DISMISSED');
    expect(await discovery.ingest(accountId, [post('b', `Use S${tag}`)])).toBe(0);
    expect((await api.discovery.forCampaign(campaignId)).length).toBe(0);
    expect(
      (await api.discovery.forCampaign(campaignId, { status: 'DISMISSED' })).map((p) => p.id),
    ).toEqual([b.id]);
  });

  it("never re-suggests a post the team already tracks, and rejects another creator's deliverable", async () => {
    await api.content.create({
      url: `https://www.instagram.com/p/${tag}f/`,
      campaignId,
      influencerId: sara,
    });
    expect(await discovery.ingest(accountId, [post('f', `#glow${tag}`)])).toBe(0);

    expect(await discovery.ingest(accountId, [post('g', `Loving Lumiere${tag}!`)])).toBe(1);
    const g = (await api.discovery.forCampaign(campaignId)).find((p) =>
      p.url.endsWith(`${tag}g/`),
    )!;
    expect(g.signals).toEqual(['brand']);
    const other = await prisma.influencer.create({
      data: { displayName: `${tag} Other`, countryCode: 'KW' },
    });
    const otherRow = await prisma.campaignInfluencer.create({
      data: { campaignId, influencerId: other.id },
    });
    const otherTask = await prisma.deliverable.create({
      data: { campaignInfluencerId: otherRow.id, platform: 'INSTAGRAM', type: 'POST' },
    });
    expect(await status(api.discovery.add(g.id, { deliverableId: otherTask.id }))).toBe(400);
    await prisma.influencer.delete({ where: { id: other.id } });
  });

  it('only people who manage content act on suggestions; other brands see nothing', async () => {
    const g = (await api.discovery.forCampaign(campaignId))[0]!;
    const ops = await staff('ops', 'OPERATIONS_MANAGER');
    expect((await ops.discovery.forCampaign(campaignId)).length).toBe(1);
    expect(await status(ops.discovery.dismiss(g.id))).toBe(403);
    expect(await status(ops.discovery.runForCampaign(campaignId))).toBe(403);
    const scoped = await staff('scoped', 'GENERAL_MANAGER', [otherBrandId]);
    expect(await status(scoped.discovery.forCampaign(campaignId))).toBe(404);
    expect(await status(scoped.discovery.add(g.id, {}))).toBe(404);
  });

  it('"look now" says which accounts cannot be read (no key here) without calling out', async () => {
    const run = await api.discovery.runForCampaign(campaignId);
    expect(run).toMatchObject({ checked: 0, found: 0 });
    expect(run.unavailable).toContainEqual({
      platform: 'INSTAGRAM',
      username: `${tag.toLowerCase()}sara`,
      reason: 'NO_CREDENTIAL',
    });
    // The worker has nothing to read without keys either.
    expect(await discovery.runDue(10)).toEqual({ checked: 0, found: 0 });
  });
});
