import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Arabic-aware search: a name typed with أ/ا, ة/ه, ى/ي or without its
 * diacritics finds the same records everywhere people search — the
 * directory and pickers, the campaign list, posts, the search page and the
 * quick palette. Also: a brand-scoped user's Trends search stays inside
 * their brands.
 */
describe('Arabic-aware search', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const stamp = Date.now();
  let brandId: string;
  let otherBrandId: string;
  let creatorId: string;
  let campaignId: string;
  let contentId: string;
  const inspirationIds: string[] = [];

  // Stored as people write them…
  const storedCreator = `أمينة الفارسيّة ${stamp}`;
  const storedCampaign = `حملة إطلاق مصطفى ${stamp}`;
  const storedBrand = `دار الأزياء ${stamp}`;
  // …and searched the other way.
  const typedCreator = `امينه الفارسيه ${stamp}`;
  const typedCampaign = `حمله اطلاق مصطفي ${stamp}`;
  const typedBrand = `دار الازياء ${stamp}`;

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (await prisma.brand.create({ data: { name: storedBrand, slug: `ar-${stamp}` } })).id;
    otherBrandId = (
      await prisma.brand.create({ data: { name: `Other ${stamp}`, slug: `ar-other-${stamp}` } })
    ).id;
    creatorId = (
      await prisma.influencer.create({ data: { displayName: storedCreator, countryCode: 'KW' } })
    ).id;
    await prisma.brandInfluencer.create({ data: { brandId, influencerId: creatorId } });
    campaignId = (
      await prisma.campaign.create({
        data: { brandId, name: storedCampaign, slug: `ar-${stamp}-c`, status: 'ACTIVE' },
      })
    ).id;
    contentId = (
      await prisma.publishedContent.create({
        data: {
          platform: 'INSTAGRAM',
          originalUrl: `https://www.instagram.com/p/ar${stamp}/`,
          caption: `مع ${storedCreator} اليوم`,
          brandId,
          campaignId,
          influencerId: creatorId,
        },
      })
    ).id;
    for (const [b, title] of [
      [brandId, `فكرة جميلة ${stamp}`],
      [otherBrandId, `فكرة جميلة ${stamp} أخرى`],
    ] as const) {
      inspirationIds.push(
        (
          await prisma.inspirationItem.create({
            data: {
              url: `https://www.instagram.com/p/insp${stamp}${b.slice(-4)}/`,
              title,
              brandId: b,
            },
          })
        ).id,
      );
    }
  });

  afterAll(async () => {
    await prisma.inspirationItem.deleteMany({ where: { id: { in: inspirationIds } } });
    await prisma.publishedContent.deleteMany({ where: { id: contentId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.influencer.deleteMany({ where: { id: creatorId } });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.$disconnect();
    for (const u of users) await deleteUser(u);
    await app.close();
  });

  it('finds a creator in the directory (and its pickers) whatever the spelling', async () => {
    for (const q of [typedCreator, storedCreator, `الفارسية ${stamp}`]) {
      const page = await api.influencers.list({ q });
      expect(
        page.data.map((i) => i.id),
        q,
      ).toEqual([creatorId]);
    }
  });

  it('finds a campaign by its name typed another way', async () => {
    const page = await api.campaigns.list({ q: typedCampaign });
    expect(page.data.map((c) => c.id)).toEqual([campaignId]);
  });

  it('finds posts by their caption', async () => {
    const feed = await api.content.feed({ q: typedCreator });
    expect(feed.data.map((c) => c.id)).toEqual([contentId]);
  });

  it('ranks folded matches on the search page and in the quick palette', async () => {
    const page = await api.search.page({ q: typedCreator });
    const creator = page.results.find((r) => r.id === creatorId);
    expect(creator?.matchedOn).toBe('name');
    expect(creator?.score).toBeGreaterThan(0);
    expect(page.results.some((r) => r.id === contentId)).toBe(true);

    const brands = await api.search.page({ q: typedBrand, types: 'brand' });
    expect(brands.results.map((r) => r.id)).toEqual([brandId]);

    const quick = await api.search.query({ q: typedCampaign });
    expect(quick.filter((r) => r.type === 'campaign').map((r) => r.id)).toEqual([campaignId]);
  });

  it("keeps a brand-scoped user's Trends search inside their brands", async () => {
    const { hash } = await import('@node-rs/argon2');
    const email = `ar_scoped_${stamp}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Scoped',
        role: 'STAFF',
        roleProfile: 'GENERAL_MANAGER',
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    await prisma.userBrandAccess.create({ data: { userId: user.id, brandId } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    const scoped = await clientFor(app, { authorization: `Bearer ${accessToken}` });

    // Spelled as stored and spelled another way: only the user's own brand.
    for (const search of [`فكرة جميلة ${stamp}`, `فكره جميله ${stamp}`]) {
      const found = await scoped.inspiration.list({ search });
      expect(
        found.data.map((i) => i.id),
        search,
      ).toEqual([inspirationIds[0]]);
    }
    const all = await api.inspiration.list({ search: `فكرة جميلة ${stamp}` });
    expect(all.data.map((i) => i.id).sort()).toEqual([...inspirationIds].sort());
  });
});
