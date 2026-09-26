import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.7 — the full search page: counts per type (for its tabs) whatever type
 * is shown, a deleted note never matches, and posts follow their creator's
 * country scope in both the page and the quick palette.
 */
describe('P3.7 — search page', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const stamp = Date.now();
  const token = `qsp${stamp}`;
  let brandId: string;
  let kwCreator: string;
  let saCreator: string;
  let ghost: string;
  let campaignId: string;

  beforeAll(async () => {
    app = await makeApp();
    admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (
      await prisma.brand.create({ data: { name: `${token} Brand`, slug: `${token}-brand` } })
    ).id;
    kwCreator = (
      await prisma.influencer.create({
        data: { displayName: `${token} Kuwait`, countryCode: 'KW' },
      })
    ).id;
    saCreator = (
      await prisma.influencer.create({
        data: { displayName: `Riyadh ${stamp}`, countryCode: 'SA' },
      })
    ).id;
    // Found only through a note — which is then deleted.
    ghost = (
      await prisma.influencer.create({ data: { displayName: `Ghost ${stamp}`, countryCode: 'KW' } })
    ).id;
    await prisma.note.create({
      data: { influencerId: ghost, body: `about ${token}`, deletedAt: new Date() },
    });
    for (const id of [kwCreator, saCreator, ghost])
      await prisma.brandInfluencer.create({ data: { brandId, influencerId: id } });
    campaignId = (
      await prisma.campaign.create({
        data: { brandId, name: `${token} Launch`, slug: `${token}-launch`, status: 'ACTIVE' },
      })
    ).id;
    for (const [n, influencerId] of [
      ['a', kwCreator],
      ['b', saCreator],
    ] as const) {
      await prisma.publishedContent.create({
        data: {
          platform: 'INSTAGRAM',
          originalUrl: `https://www.instagram.com/p/${token}${n}/`,
          caption: `Launch day ${token} ${n}`,
          brandId,
          campaignId,
          influencerId,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.publishedContent.deleteMany({ where: { brandId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.influencer.deleteMany({ where: { id: { in: [kwCreator, saCreator, ghost] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('counts every type, whichever type is shown', async () => {
    const all = await api.search.page({ q: token });
    expect(all.counts).toEqual({ influencer: 1, campaign: 1, brand: 1, published_content: 2 });
    expect(all.total).toBe(5);
    expect(all.truncated).toBe(false);

    const posts = await api.search.page({ q: token, types: 'published_content' });
    expect(posts.counts).toEqual(all.counts);
    expect(posts.total).toBe(2);
    expect(posts.results.map((r) => r.type)).toEqual(['published_content', 'published_content']);
    expect(posts.results[0]!.matchedOn).toBe('caption');
  });

  it("a deleted note doesn't match", async () => {
    const people = await api.search.page({ q: token, types: 'influencer' });
    expect(people.results.map((r) => r.id)).toEqual([kwCreator]);
  });

  it("posts by a creator outside the viewer's countries stay hidden", async () => {
    const { hash } = await import('@node-rs/argon2');
    const email = `${token}_kw@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${token} KW staff`,
        role: 'STAFF',
        roleProfile: 'INFLUENCER_MANAGER',
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    await prisma.userCountryAccess.create({ data: { userId: user.id, countryCode: 'KW' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    const kw = await clientFor(app, { authorization: `Bearer ${accessToken}` });

    const page = await kw.search.page({ q: token, types: 'published_content' });
    expect(page.counts.published_content).toBe(1);
    expect(page.results.map((r) => r.subtitle)).toEqual([`${token} Kuwait`]);

    const quick = await kw.search.query({ q: token, limit: 8 });
    expect(quick.filter((r) => r.type === 'published_content').map((r) => r.subtitle)).toEqual([
      `${token} Kuwait`,
    ]);
  });
});
