import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.7 — audience insights and the directory filters built on them: the
 * newest breakdown per account is the one "audience in Kuwait ≥ 50%"
 * reads; engagement rate, language, gender and usual fee filter too; shares
 * over 100% are refused; everything keeps to country and brand scope.
 */
describe('P3.7 — audience insights and directory filters', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P37A${Date.now()}`;
  let brandId: string;
  let aya: string;
  let bader: string;
  let ayaIg: string;
  let baderIg: string;
  let latestAya: string;

  const ids = async (params: Record<string, string | number>) =>
    (await api.influencers.list({ q: tag, pageSize: 50, ...params })).data
      .map((i) => i.displayName)
      .sort();

  async function status(p: Promise<unknown>) {
    try {
      await p;
      return 200;
    } catch (e) {
      return (e as ApiError).status;
    }
  }

  beforeAll(async () => {
    app = await makeApp();
    admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (
      await prisma.brand.create({ data: { name: `${tag} Brand`, slug: `${tag.toLowerCase()}-b` } })
    ).id;
    aya = (
      await api.influencers.create({
        displayName: `${tag} Aya`,
        countryCode: 'KW',
        languages: ['Arabic', 'English'],
        gender: 'FEMALE',
        rateMin: 200,
        rateMax: 400,
        rateCurrency: 'KWD',
      })
    ).id;
    bader = (
      await api.influencers.create({
        displayName: `${tag} Bader`,
        countryCode: 'KW',
        languages: ['english'],
        gender: 'MALE',
        rateMin: 800,
        rateMax: 1000,
      })
    ).id;
    for (const id of [aya, bader])
      await prisma.brandInfluencer.create({ data: { brandId, influencerId: id } });
    ayaIg = (
      await prisma.socialAccount.create({
        data: { influencerId: aya, platform: 'INSTAGRAM', username: `${tag}_aya` },
      })
    ).id;
    baderIg = (
      await prisma.socialAccount.create({
        data: { influencerId: bader, platform: 'INSTAGRAM', username: `${tag}_bader` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.influencer.deleteMany({ where: { id: { in: [aya, bader] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('records insights; the newest per account is the latest and sets its engagement rate', async () => {
    const recent = await api.audience.create(ayaIg, {
      capturedAt: '2026-09-01',
      countries: [
        { countryCode: 'SA', pct: 20 },
        { countryCode: 'KW', pct: 62 },
      ],
      femalePct: 70,
      malePct: 30,
      age18to24Pct: 40,
      age25to34Pct: 45,
      engagementRate: 4.2,
    });
    latestAya = recent.id;
    expect(recent).toMatchObject({
      isLatest: true,
      platform: 'INSTAGRAM',
      username: `${tag}_aya`,
      source: 'MANUAL',
      countries: [
        { countryCode: 'KW', pct: 62 },
        { countryCode: 'SA', pct: 20 },
      ],
      ages: { age18to24Pct: 40, age25to34Pct: 45, age13to17Pct: null },
    });
    // An older screenshot entered afterwards doesn't take over.
    const older = await api.audience.create(ayaIg, {
      capturedAt: '2026-06-01',
      countries: [{ countryCode: 'KW', pct: 30 }],
    });
    expect(older.isLatest).toBe(false);
    const list = await api.audience.forInfluencer(aya);
    expect(list.map((i) => [i.id, i.isLatest])).toEqual([
      [recent.id, true],
      [older.id, false],
    ]);
    const detail = await api.influencers.get(aya);
    expect(detail.socialAccounts[0]!.engagementRate).toBe(4.2);
    expect(detail).toMatchObject({
      gender: 'FEMALE',
      rateMin: 200,
      rateMax: 400,
      rateCurrency: 'KWD',
    });

    await api.audience.create(baderIg, {
      capturedAt: '2026-09-10',
      countries: [
        { countryCode: 'KW', pct: 35 },
        { countryCode: 'SA', pct: 50 },
      ],
      engagementRate: 1.5,
    });
  });

  it('filters the directory by audience country, engagement, language, gender and usual fee', async () => {
    expect(await ids({ audienceCountry: 'KW', audienceMinPct: 50 })).toEqual([`${tag} Aya`]);
    expect(await ids({ audienceCountry: 'KW', audienceMinPct: 30 })).toEqual([
      `${tag} Aya`,
      `${tag} Bader`,
    ]);
    expect(await ids({ audienceCountry: 'SA', audienceMinPct: 40 })).toEqual([`${tag} Bader`]);
    expect(await ids({ audienceCountry: 'KW', audienceMinPct: 50, platform: 'TIKTOK' })).toEqual(
      [],
    );
    expect(await ids({ minEngagementRate: 3 })).toEqual([`${tag} Aya`]);
    expect(await ids({ maxEngagementRate: 2 })).toEqual([`${tag} Bader`]);
    expect(await ids({ language: 'ar' })).toEqual([`${tag} Aya`]);
    expect(await ids({ language: 'en' })).toEqual([`${tag} Aya`, `${tag} Bader`]);
    expect(await ids({ gender: 'MALE' })).toEqual([`${tag} Bader`]);
    expect(await ids({ minRate: 300, maxRate: 500 })).toEqual([`${tag} Aya`]);
    expect(await ids({ minRate: 900 })).toEqual([`${tag} Bader`]);
    expect(await ids({ maxRate: 100 })).toEqual([]);
    expect(await ids({ minRate: 100, rateCurrency: 'SAR' })).toEqual([]);
  });

  it('removing the newest makes the one before it the latest', async () => {
    await api.audience.remove(latestAya);
    const list = await api.audience.forInfluencer(aya);
    expect(list).toHaveLength(1);
    expect(list[0]!.isLatest).toBe(true);
    expect(await ids({ audienceCountry: 'KW', audienceMinPct: 50 })).toEqual([]);
    expect(await ids({ audienceCountry: 'KW', audienceMinPct: 30 })).toEqual([
      `${tag} Aya`,
      `${tag} Bader`,
    ]);
  });

  it('refuses shares over 100%, repeated countries, a future date, and a fee that runs backwards', async () => {
    const base = { capturedAt: '2026-09-01' };
    expect(
      await status(
        api.audience.create(ayaIg, {
          ...base,
          countries: [
            { countryCode: 'KW', pct: 70 },
            { countryCode: 'SA', pct: 50 },
          ],
        }),
      ),
    ).toBe(422);
    expect(
      await status(
        api.audience.create(ayaIg, {
          ...base,
          countries: [
            { countryCode: 'KW', pct: 10 },
            { countryCode: 'KW', pct: 20 },
          ],
        }),
      ),
    ).toBe(422);
    expect(await status(api.audience.create(ayaIg, { ...base, femalePct: 80, malePct: 40 }))).toBe(
      422,
    );
    expect(
      await status(api.audience.create(ayaIg, { ...base, age18to24Pct: 60, age25to34Pct: 60 })),
    ).toBe(422);
    expect(await status(api.audience.create(ayaIg, { capturedAt: '2099-01-01' }))).toBe(422);
    expect(await status(api.influencers.update(aya, { rateMin: 500, rateMax: 100 }))).toBe(400);
  });

  it("keeps to scope, and the screenshot must be the creator's own file", async () => {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_sa@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} SA`,
        role: 'STAFF',
        roleProfile: 'INFLUENCER_MANAGER',
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    await prisma.userCountryAccess.create({ data: { userId: user.id, countryCode: 'SA' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    const sa = await clientFor(app, { authorization: `Bearer ${accessToken}` });
    expect(await status(sa.audience.forInfluencer(aya))).toBe(404);
    expect(await status(sa.audience.create(ayaIg, { capturedAt: '2026-09-01' }))).toBe(404);

    const other = await prisma.attachment.create({
      data: {
        influencerId: bader,
        fileName: 'x.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey: `${tag}/x.png`,
        kind: 'image',
      },
    });
    expect(
      await status(
        api.audience.create(ayaIg, { capturedAt: '2026-09-01', attachmentId: other.id }),
      ),
    ).toBe(400);
  });
});
