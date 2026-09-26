import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.3 — the client report shared by link: made by people who manage
 * campaigns, opened without signing in in the link's language, costs only
 * when chosen by someone who may see them, visits counted for people but
 * not for link previews, and a link that is turned off or expired stops
 * working. Written against the typed API client.
 */
describe('P3.3 — client report links', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P33${Date.now()}`;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let sara: string;
  const PERSON =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

  async function staff(
    label: string,
    roleProfile: 'INFLUENCER_MANAGER' | 'GENERAL_MANAGER',
    opts: { brands?: string[]; noFinance?: boolean } = {},
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
    for (const b of opts.brands ?? [])
      await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: b } });
    if (opts.noFinance)
      await prisma.userCapability.create({
        data: { userId: user.id, capability: 'FINANCE_VIEW', granted: false },
      });
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
  const tokenOf = (path: string) => path.replace('/share/r/', '');

  beforeAll(async () => {
    app = await makeApp();
    admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
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
    sara = (
      await prisma.influencer.create({ data: { displayName: `${tag} Sara`, countryCode: 'KW' } })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Winter Glow`,
          slug: `${tag.toLowerCase()}-winter`,
          status: 'ACTIVE',
          currency: 'KWD',
          plannedBudget: 500,
        },
      })
    ).id;
    await prisma.campaignInfluencer.create({
      data: {
        campaignId,
        influencerId: sara,
        dealType: 'PAID',
        agreedCost: 120,
        participationStatus: 'CONFIRMED',
      },
    });
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: sara } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('makes a link (English, no costs, 30 days by default) that opens without signing in', async () => {
    const share = await api.campaigns.shareReport(campaignId, {});
    expect(share).toMatchObject({
      campaignId,
      locale: 'en',
      includeCosts: false,
      active: true,
      viewCount: 0,
      revokedAt: null,
    });
    expect(share.path).toMatch(/^\/share\/r\/[A-Za-z0-9_-]{43}$/);
    const days = (new Date(share.expiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    // Only a hash finds the link; the token itself isn't stored in the clear.
    const row = await prisma.reportShareLink.findUniqueOrThrow({ where: { id: share.id } });
    expect(row.tokenHash).not.toContain(tokenOf(share.path));
    expect(row.tokenSealed).not.toContain(tokenOf(share.path));

    const anyone = await clientFor(app, { 'user-agent': PERSON });
    const report = await anyone.campaigns.sharedReport(tokenOf(share.path));
    expect(report).toMatchObject({
      locale: 'en',
      includeCosts: false,
      campaign: { id: campaignId, brandName: `${tag} Glow` },
    });
    expect(report.totals.spend).toBeNull();
    expect(report.totals.plannedBudget).toBeNull();
    expect(report.creators.every((c) => c.spend === null)).toBe(true);

    const activity = await prisma.activityLog.findFirst({
      where: { campaignId, message: { contains: 'shared the client report by link' } },
    });
    expect(activity).not.toBeNull();
  });

  it('counts people, not link previews', async () => {
    const share = await api.campaigns.shareReport(campaignId, { locale: 'ar' });
    const token = tokenOf(share.path);
    const person = await clientFor(app, { 'user-agent': PERSON });
    const whatsapp = await clientFor(app, { 'user-agent': 'WhatsApp/2.24.1 A' });
    expect((await person.campaigns.sharedReport(token)).locale).toBe('ar');
    await person.campaigns.sharedReport(token);
    await whatsapp.campaigns.sharedReport(token);
    await person.campaigns.sharedReport(token, { preview: '1' });
    const listed = (await api.campaigns.reportShares(campaignId)).find((s) => s.id === share.id)!;
    expect(listed.viewCount).toBe(2);
    expect(listed.lastViewedAt).not.toBeNull();
    expect(listed.path).toBe(share.path);
  });

  it('shows costs only when someone who may see them chose to', async () => {
    const withCosts = await api.campaigns.shareReport(campaignId, {
      includeCosts: true,
      expiresInDays: null,
    });
    expect(withCosts).toMatchObject({ includeCosts: true, expiresAt: null });
    const anyone = await clientFor(app, { 'user-agent': PERSON });
    const report = await anyone.campaigns.sharedReport(tokenOf(withCosts.path));
    expect(report.includeCosts).toBe(true);
    expect(report.totals.spend).toBe(120);
    expect(report.totals.plannedBudget).toBe(500);

    const manager = await staff('gm-nofin', 'GENERAL_MANAGER', { noFinance: true });
    expect(await status(manager.campaigns.shareReport(campaignId, { includeCosts: true }))).toBe(
      403,
    );
    const plain = await manager.campaigns.shareReport(campaignId, { locale: 'en' });
    expect(plain.includeCosts).toBe(false);
  });

  it('only people who manage campaigns make or turn off links; other brands see nothing', async () => {
    const im = await staff('im', 'INFLUENCER_MANAGER');
    expect(await status(im.campaigns.reportShares(campaignId))).toBe(403);
    expect(await status(im.campaigns.shareReport(campaignId, {}))).toBe(403);

    const scoped = await staff('scoped', 'GENERAL_MANAGER', { brands: [otherBrandId] });
    expect(await status(scoped.campaigns.reportShares(campaignId))).toBe(404);
    expect(await status(scoped.campaigns.shareReport(campaignId, {}))).toBe(404);
    const any = await prisma.reportShareLink.findFirstOrThrow({ where: { campaignId } });
    expect(await status(scoped.campaigns.revokeReportShare(any.id))).toBe(404);
    expect(await status(api.campaigns.shareReport(campaignId, { expiresInDays: 0 }))).toBe(422);
  });

  it('a link turned off or expired stops working; unknown links are not found', async () => {
    const anyone = await clientFor(app, { 'user-agent': PERSON });
    const share = await api.campaigns.shareReport(campaignId, {});
    const token = tokenOf(share.path);
    const off = await api.campaigns.revokeReportShare(share.id);
    expect(off).toMatchObject({ active: false });
    expect(off.revokedAt).not.toBeNull();
    expect(await status(anyone.campaigns.sharedReport(token))).toBe(404);
    // Turning it off again changes nothing.
    expect((await api.campaigns.revokeReportShare(share.id)).revokedAt).toBe(off.revokedAt);

    const old = await api.campaigns.shareReport(campaignId, { expiresInDays: 1 });
    await prisma.reportShareLink.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await status(anyone.campaigns.sharedReport(tokenOf(old.path)))).toBe(404);
    expect(
      (await api.campaigns.reportShares(campaignId)).find((s) => s.id === old.id)?.active,
    ).toBe(false);

    expect(await status(anyone.campaigns.sharedReport('x'.repeat(43)))).toBe(404);
    expect(await status(api.campaigns.revokeReportShare('nope'))).toBe(404);
  });

  it('downloads the shared report as Excel without signing in', async () => {
    const share = await api.campaigns.shareReport(campaignId, { locale: 'ar' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/reports/${tokenOf(share.path)}/xlsx`,
      headers: { 'user-agent': PERSON },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/-report-ar\.xlsx"$/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});
