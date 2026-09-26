import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.5 — creator advertising licences: one per creator and country, checked
 * against the countries a campaign is for (only those that need a licence,
 * set by an admin). Missing/expired/ending-during-the-campaign show on the
 * roster check and as one Needs Attention line per campaign; licences about
 * to expire are reminded about once. Written against the typed API client.
 */
describe('P3.5 — creator licences', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P35L${Date.now()}`;
  const DAY = 864e5;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let sara: string;
  let maya: string;
  let nora: string;
  let saraKw: string;
  let originalCountries: string[];

  async function staff(
    label: string,
    roleProfile: 'INFLUENCER_MANAGER' | 'GENERAL_MANAGER',
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
    originalCountries = (await api.licences.settings()).licenceCountryCodes;
    await api.licences.updateSettings({ licenceCountryCodes: ['KW', 'SA', 'AE'] });

    brandId = (
      await prisma.brand.create({
        data: { name: `${tag} Glow`, slug: `${tag.toLowerCase()}-glow` },
      })
    ).id;
    otherBrandId = (
      await prisma.brand.create({
        data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-other` },
      })
    ).id;
    const mk = async (name: string) =>
      (
        await prisma.influencer.create({
          data: { displayName: `${tag} ${name}`, countryCode: 'KW' },
        })
      ).id;
    sara = await mk('Sara');
    maya = await mk('Maya');
    nora = await mk('Nora');
    for (const id of [sara, maya, nora])
      await prisma.brandInfluencer.create({ data: { brandId, influencerId: id } });
    campaignId = (
      await api.campaigns.create({
        brandId,
        name: `${tag} Winter`,
        status: 'ACTIVE',
        endDate: new Date(Date.now() + 20 * DAY),
        marketCountryCodes: ['KW', 'SA', 'EG', 'KW'],
      })
    ).id;
    for (const id of [sara, maya, nora]) {
      await prisma.campaignInfluencer.create({
        data: { campaignId, influencerId: id, participationStatus: 'CONFIRMED' },
      });
    }
  });

  afterAll(async () => {
    await api.licences.updateSettings({ licenceCountryCodes: originalCountries });
    await prisma.notification.deleteMany({ where: { influencerId: { in: [sara, maya, nora] } } });
    await prisma.activityLog.deleteMany({
      where: { OR: [{ campaignId }, { influencerId: { in: [sara, maya, nora] } }] },
    });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: { in: [sara, maya, nora] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it("stores the campaign's countries once each", async () => {
    const c = await api.campaigns.get(campaignId);
    expect(c.marketCountryCodes).toEqual(['KW', 'SA', 'EG']);
  });

  it('records one licence per creator and country, with its status', async () => {
    const kw = await api.licences.create(sara, {
      countryCode: 'KW',
      authority: 'Ministry of Commerce',
      number: 'KW-123',
      issuedAt: new Date(Date.now() - 100 * DAY),
      expiresAt: new Date(Date.now() + 200 * DAY),
    });
    saraKw = kw.id;
    expect(kw).toMatchObject({
      countryCode: 'KW',
      number: 'KW-123',
      status: 'VALID',
      document: null,
    });
    expect(kw.daysLeft).toBeGreaterThan(190);

    const sa = await api.licences.create(sara, {
      countryCode: 'SA',
      authority: 'Mawthooq',
      expiresAt: new Date(Date.now() - 2 * DAY),
    });
    expect(sa.status).toBe('EXPIRED');
    await api.licences.create(nora, {
      countryCode: 'KW',
      expiresAt: new Date(Date.now() + 15 * DAY),
    });
    await api.licences.create(nora, { countryCode: 'SA' });

    const list = await api.licences.forInfluencer(sara);
    expect(list.map((l) => [l.countryCode, l.status])).toEqual([
      ['KW', 'VALID'],
      ['SA', 'EXPIRED'],
    ]);
    const nearly = (await api.licences.forInfluencer(nora)).find((l) => l.countryCode === 'KW')!;
    expect(nearly.status).toBe('EXPIRING_SOON');

    // Same country twice → edit instead.
    expect(await status(api.licences.create(sara, { countryCode: 'KW' }))).toBe(409);
    // Dates the wrong way round: refused by validation, and by the service on an edit.
    expect(
      await status(
        api.licences.create(maya, {
          countryCode: 'AE',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() - DAY),
        }),
      ),
    ).toBe(422);
    expect(
      await status(api.licences.update(kw.id, { expiresAt: new Date(Date.now() - 200 * DAY) })),
    ).toBe(400);
  });

  it("only takes one of the creator's own files as the scanned licence", async () => {
    const own = await prisma.attachment.create({
      data: {
        fileName: 'licence.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: `${tag}/own.pdf`,
        kind: 'pdf',
        influencerId: sara,
      },
    });
    const other = await prisma.attachment.create({
      data: {
        fileName: 'other.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: `${tag}/other.pdf`,
        kind: 'pdf',
        influencerId: maya,
      },
    });
    expect(await status(api.licences.update(saraKw, { attachmentId: other.id }))).toBe(400);
    const updated = await api.licences.update(saraKw, { attachmentId: own.id });
    expect(updated.document).toMatchObject({ id: own.id, fileName: 'licence.pdf', kind: 'pdf' });
  });

  it("checks each creator against the campaign's countries that need a licence", async () => {
    const check = await api.licences.forCampaign(campaignId);
    expect(check.markets).toEqual(['KW', 'SA', 'EG']);
    expect(check.checkedCountries).toEqual(['KW', 'SA']);
    const by = Object.fromEntries(check.creators.map((c) => [c.influencerId, c]));
    expect(by[sara]!.checks.map((c) => [c.countryCode, c.state])).toEqual([
      ['KW', 'VALID'],
      ['SA', 'EXPIRED'],
    ]);
    expect(by[maya]!.checks.map((c) => c.state)).toEqual(['MISSING', 'MISSING']);
    expect(by[nora]!.checks.map((c) => [c.countryCode, c.state])).toEqual([
      ['KW', 'EXPIRES_DURING'],
      ['SA', 'VALID'],
    ]);
    expect(Object.values(by).every((c) => !c.ok)).toBe(true);
  });

  it('raises one Needs Attention line for the campaign', async () => {
    const items = await api.dashboard.attention({ campaignId });
    const item = items.find((i) => i.kind === 'CREATOR_LICENCE');
    expect(item).toMatchObject({
      severity: 'danger',
      campaignId,
      brandId,
      link: `/campaigns/${campaignId}?tab=influencers`,
      params: { campaignName: `${tag} Winter`, missing: 2, expiring: 1 },
    });
  });

  it('an admin decides which countries are checked', async () => {
    const manager = await staff('mgr', 'GENERAL_MANAGER');
    expect((await manager.licences.settings()).licenceCountryCodes).toEqual(['KW', 'SA', 'AE']);
    expect(await status(manager.licences.updateSettings({ licenceCountryCodes: ['KW'] }))).toBe(
      403,
    );

    await api.licences.updateSettings({ licenceCountryCodes: ['KW', 'KW'] });
    const check = await api.licences.forCampaign(campaignId);
    expect(check.checkedCountries).toEqual(['KW']);
    const saraCheck = check.creators.find((c) => c.influencerId === sara)!;
    expect(saraCheck.ok).toBe(true);

    await api.licences.updateSettings({ licenceCountryCodes: [] });
    expect((await api.licences.forCampaign(campaignId)).creators).toEqual([]);
    expect(
      (await api.dashboard.attention({ campaignId })).some((i) => i.kind === 'CREATOR_LICENCE'),
    ).toBe(false);
    await api.licences.updateSettings({ licenceCountryCodes: ['KW', 'SA', 'AE'] });
  });

  it("reminds once about a licence about to expire, and again after it's renewed", async () => {
    const { runReminders, systemContext } = await import('@influenceos/domain');
    await runReminders(systemContext(), new Date());
    const sent = await prisma.notification.findMany({
      where: { category: 'LICENCE_EXPIRING', influencerId: nora },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('Creator licence expiring');
    expect(sent[0]!.body).toMatch(
      new RegExp(`^${tag} Nora's advertising licence \\(KW\\) expires in 1[45] days\\.$`),
    );
    expect(sent[0]!.targetUrl).toBe(`/influencers/${nora}`);
    // Expired ones and far-off ones aren't reminded about.
    expect(
      await prisma.notification.count({
        where: { category: 'LICENCE_EXPIRING', influencerId: sara },
      }),
    ).toBe(0);

    await runReminders(systemContext(), new Date());
    expect(
      await prisma.notification.count({
        where: { category: 'LICENCE_EXPIRING', influencerId: nora },
      }),
    ).toBe(1);

    const kw = (await api.licences.forInfluencer(nora)).find((l) => l.countryCode === 'KW')!;
    await api.licences.update(kw.id, { expiresAt: new Date(Date.now() + 25 * DAY) });
    await runReminders(systemContext(), new Date());
    expect(
      await prisma.notification.count({
        where: { category: 'LICENCE_EXPIRING', influencerId: nora },
      }),
    ).toBe(2);
  });

  it('respects permissions and brand scope', async () => {
    const outsider = await staff('outsider', 'INFLUENCER_MANAGER', [otherBrandId]);
    expect(await status(outsider.licences.forInfluencer(sara))).toBe(404);
    expect(await status(outsider.licences.create(sara, { countryCode: 'AE' }))).toBe(404);
    expect(await status(outsider.licences.update(saraKw, { number: 'X' }))).toBe(404);
    expect(await status(outsider.licences.remove(saraKw))).toBe(404);
    expect(await status(outsider.licences.forCampaign(campaignId))).toBe(404);

    const insider = await staff('insider', 'INFLUENCER_MANAGER', [brandId]);
    expect((await insider.licences.forInfluencer(sara)).length).toBe(2);
  });

  it('removes a licence and logs each change on the creator', async () => {
    const sa = (await api.licences.forInfluencer(sara)).find((l) => l.countryCode === 'SA')!;
    await api.licences.remove(sa.id);
    expect((await api.licences.forInfluencer(sara)).map((l) => l.countryCode)).toEqual(['KW']);
    expect(await status(api.licences.remove(sa.id))).toBe(404);
    const lines = await prisma.activityLog.findMany({
      where: { influencerId: sara },
      orderBy: { createdAt: 'asc' },
    });
    expect(lines.map((l) => l.message.replace(/^.*? (recorded|updated|removed) /, '$1 '))).toEqual([
      `recorded ${tag} Sara's advertising licence for KW.`,
      `recorded ${tag} Sara's advertising licence for SA.`,
      `updated ${tag} Sara's advertising licence for KW.`,
      `removed ${tag} Sara's advertising licence for SA.`,
    ]);
  });
});
