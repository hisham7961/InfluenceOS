import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.1 — Sales & ROI: promo codes and tracking links per creator, the public
 * link that counts clicks, a shop order file credited by code or link (dry
 * run, duplicates, cancelled, unreadable rows, codes reused on a later
 * campaign), hand-entered sales, undoing a file, and who may see and change
 * what. Written against the typed API client.
 */
describe('P3.1 — promo codes, tracking links and imported sales', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P31${Date.now()}`;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let laterCampaignId: string;
  let sara: string;
  let maya: string;
  let outsider: string;
  let slug: string;

  async function staff(label: string, roleProfile: 'INFLUENCER_MANAGER' | 'GENERAL_MANAGER', brands?: string[]) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: 'STAFF', roleProfile, passwordHash: await hash(password) },
    });
    users.push(user.id);
    for (const b of brands ?? []) await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: b } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
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
    brandId = (await prisma.brand.create({ data: { name: `${tag} Glow`, slug: `${tag.toLowerCase()}-glow` } })).id;
    otherBrandId = (await prisma.brand.create({ data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-other` } })).id;
    sara = (await prisma.influencer.create({ data: { displayName: `${tag} Sara`, countryCode: 'KW' } })).id;
    maya = (await prisma.influencer.create({ data: { displayName: `${tag} Maya`, countryCode: 'KW' } })).id;
    outsider = (await prisma.influencer.create({ data: { displayName: `${tag} Outsider`, countryCode: 'KW' } })).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Winter Glow`,
          slug: `${tag.toLowerCase()}-winter`,
          status: 'ACTIVE',
          currency: 'KWD',
          startDate: new Date('2026-09-01T00:00:00+03:00'),
        },
      })
    ).id;
    laterCampaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Spring Glow`,
          slug: `${tag.toLowerCase()}-spring`,
          status: 'PLANNING',
          currency: 'KWD',
          startDate: new Date('2026-11-01T00:00:00+03:00'),
        },
      })
    ).id;
    for (const [c, i, fee] of [
      [campaignId, sara, 100],
      [campaignId, maya, 50],
      [laterCampaignId, sara, 80],
    ] as const) {
      await prisma.campaignInfluencer.create({
        data: { campaignId: c, influencerId: i, dealType: 'PAID', agreedCost: fee, participationStatus: 'CONFIRMED' },
      });
    }
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: { in: [sara, maya, outsider] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('gives creators codes and links; refuses clashes and creators not on the campaign', async () => {
    const code = await api.sales.createPromoCode(campaignId, { influencerId: sara, code: 'sara 15', discount: '15%' });
    expect(code).toMatchObject({ code: 'sara 15', discount: '15%', influencerId: sara, orders: 0, isActive: true });
    // Starts with the campaign by default (a Kuwait day).
    expect(code.validFrom).toBe('2026-08-31T21:00:00.000Z');

    expect(await status(api.sales.createPromoCode(campaignId, { influencerId: sara, code: 'SARA15' }))).toBe(409);
    expect(await status(api.sales.createPromoCode(laterCampaignId, { influencerId: sara, code: 'FREE', validTo: '2026-12-31' }))).toBe(200);
    // Another creator can't share a code for overlapping dates.
    expect(await status(api.sales.createPromoCode(campaignId, { influencerId: maya, code: 'free' }))).toBe(409);
    expect(await status(api.sales.createPromoCode(campaignId, { influencerId: outsider, code: 'OUT10' }))).toBe(400);
    expect(await status(api.sales.createPromoCode(campaignId, { influencerId: maya, code: '<script>' }))).toBe(422);

    const link = await api.sales.createLink(campaignId, { influencerId: sara, destinationUrl: 'https://shop.example/glow?ref=home' });
    slug = link.slug;
    expect(link.path).toBe(`/r/${slug}`);
    const target = new URL(link.targetUrl);
    expect(target.searchParams.get('ref')).toBe('home');
    expect(target.searchParams.get('utm_medium')).toBe('influencer');
    expect(target.searchParams.get('utm_campaign')).toBe(`${tag.toLowerCase()}-winter`);
    expect(target.searchParams.get('utm_content')).toBe(slug);
    expect(await status(api.sales.createLink(campaignId, { influencerId: sara, destinationUrl: 'javascript:alert(1)' }))).toBe(422);
  });

  it('the public link sends people on and counts people, not previews or paused links', async () => {
    const hit = (ua: string, q = '') =>
      app.inject({ method: 'GET', url: `/api/v1/public/links/${slug}${q}`, headers: { 'user-agent': ua } });
    const browser = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0';
    const res = await hit(browser);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { url: string }).url).toContain('https://shop.example/glow');
    await hit('WhatsApp/2.23.20.0 A');
    await hit(browser, '?preview=1');
    expect((await prisma.trackingLink.findUnique({ where: { slug } }))!.clickCount).toBe(1);
    const days = await prisma.trackingLinkClickDay.findMany({ where: { link: { slug } } });
    expect(days.map((d) => d.clicks)).toEqual([1]);

    expect((await app.inject({ method: 'GET', url: '/api/v1/public/links/nope123' })).statusCode).toBe(404);

    const link = await prisma.trackingLink.findUniqueOrThrow({ where: { slug } });
    await api.sales.updateLink(link.id, { isActive: false });
    expect((await hit(browser)).statusCode).toBe(200);
    expect((await prisma.trackingLink.findUnique({ where: { slug } }))!.clickCount).toBe(1);
    await api.sales.updateLink(link.id, { isActive: true });
  });

  const file = () => [
    { orderRef: '#1001', date: '2026-09-02 10:00', amount: '12.500', code: 'SARA15' },
    { orderRef: '#1002', date: '٣/٩/٢٠٢٦', amount: '٢٠٫٠٠٠ د.ك', code: 'sara15' },
    { orderRef: '#1003', date: '2026-09-03', amount: '9.000', code: 'MAYA10' },
    { orderRef: '#1004', date: '2026-09-04', amount: '30', link: `https://go.example/r/${slug}` },
    { orderRef: '#1001', date: '2026-09-02 10:00', amount: '12.500', code: 'SARA15' },
    { orderRef: '#1005', date: '2026-09-05', amount: '7.000', code: 'SARA15', status: 'Refunded' },
    { orderRef: '#1006', date: 'soon', amount: '7.000', code: 'SARA15' },
    { orderRef: '#1007', date: '2026-08-15', amount: '7.000', code: 'SARA15' },
  ];

  it('checks a shop file without saving, then records it', async () => {
    const check = await api.sales.importFile(brandId, { fileName: 'orders.csv', dryRun: true, rows: file() });
    expect(check).toMatchObject({
      dryRun: true,
      importId: null,
      rows: 8,
      matched: 3,
      duplicates: 1,
      unmatched: 1,
      outsideDates: 1,
      cancelled: 1,
      invalidCount: 1,
      invalid: [{ row: 8, problem: 'date' }],
      unknownCodes: [{ code: 'MAYA10', rows: 1 }],
    });
    expect(check.byCampaign).toEqual([
      { campaignId, campaignName: `${tag} Winter Glow`, orders: 3, revenue: [{ currency: 'KWD', amount: 62.5 }] },
    ]);
    expect(await prisma.sale.count({ where: { brandId } })).toBe(0);

    const done = await api.sales.importFile(brandId, { fileName: 'orders.csv', rows: file() });
    expect(done.importId).toBeTruthy();
    expect(done.matched).toBe(3);

    const again = await api.sales.importFile(brandId, { fileName: 'orders.csv', rows: file() });
    expect(again).toMatchObject({ matched: 0, duplicates: 4, importId: null });
  });

  it("shows the campaign's sales and, with finance access, return on spend", async () => {
    const s = await api.sales.forCampaign(campaignId);
    expect(s).toMatchObject({ currency: 'KWD', orders: 3, revenue: [{ currency: 'KWD', amount: 62.5 }], clicks: 1, canManage: true });
    expect(s.spend).toBe(150);
    expect(s.roas).toBe(0.42);
    expect(s.costPerOrder).toBe(50);
    expect(s.conversionRate).toBe(1); // one order through the link, one click
    const [top] = s.creators;
    expect(top).toMatchObject({ influencerId: sara, orders: 3, fee: 100, roas: 0.63, costPerOrder: 33.33, codes: ['sara 15'], clicks: 1 });
    expect(s.promoCodes.find((c) => c.code === 'sara 15')).toMatchObject({ orders: 2, revenue: [{ currency: 'KWD', amount: 32.5 }] });
    expect(s.links[0]).toMatchObject({ orders: 1, clicks: 1 });
    expect(s.recentSales.map((r) => r.orderRef)).toEqual(['#1004', '#1002', '#1001']);
    expect(s.imports).toHaveLength(1);
    expect(s.imports[0]).toMatchObject({ fileName: 'orders.csv', rowCount: 8, imported: 3, ordersOnRecord: 3 });
  });

  it('the client report and the owner dashboard show the sales', async () => {
    const report = await api.campaigns.report(campaignId);
    expect(report.sales).toEqual({ orders: 3, revenue: [{ currency: 'KWD', amount: 62.5 }], clicks: 1, roas: 0.42, costPerOrder: 50 });
    // Return on spend reveals spend: it goes when costs are left out.
    const noCosts = await api.campaigns.report(campaignId, { costs: false });
    expect(noCosts.sales).toMatchObject({ orders: 3, roas: null, costPerOrder: null });

    const exec = await api.reports.execDashboard({ brandId, period: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(exec.period.current).toMatchObject({ orders: 3, revenue: [{ currency: 'KWD', amount: 62.5 }] });
    expect(exec.period.previous.orders).toBe(0);
  });

  it('a code reused on a later campaign takes over from its start date', async () => {
    await api.sales.createPromoCode(laterCampaignId, { influencerId: sara, code: 'SARA15' });
    const r = await api.sales.importFile(brandId, {
      rows: [
        { orderRef: '#2001', date: '05/11/2026', amount: '10', code: 'SARA15' },
        { orderRef: '#2002', date: '01/10/2026', amount: '10', code: 'SARA15' },
      ],
    });
    expect(r.byCampaign.map((b) => [b.campaignId, b.orders]).sort()).toEqual([[campaignId, 1], [laterCampaignId, 1]].sort());
    const moved = await prisma.sale.findFirstOrThrow({ where: { orderRef: '#2001', brandId } });
    expect(moved.campaignId).toBe(laterCampaignId);
  });

  it('records sales by hand and shows them on the creator page', async () => {
    const sale = await api.sales.add(campaignId, { influencerId: maya, orders: 5, amount: 60, occurredAt: '2026-09-10', note: 'Brand report' });
    expect(sale).toMatchObject({ source: 'MANUAL', orders: 5, amount: 60, currency: 'KWD', influencerId: maya });
    expect(await status(api.sales.add(campaignId, { influencerId: outsider, orders: 1, amount: 1, occurredAt: '2026-09-10' }))).toBe(400);
    const perf = await api.influencers.performance(maya);
    expect(perf.sales).toMatchObject({ orders: 5, revenue: [{ currency: 'KWD', amount: 60 }], clicks: 0 });
    await api.sales.remove(sale.id);
    expect((await api.influencers.performance(maya)).sales).toBeNull();
  });

  it('only people who manage campaigns change things; spend stays with finance; other brands see nothing', async () => {
    const im = await staff('im', 'INFLUENCER_MANAGER');
    const view = await im.sales.forCampaign(campaignId);
    expect(view).toMatchObject({ canManage: false, spend: null, roas: null, costPerOrder: null });
    expect(view.orders).toBeGreaterThan(0);
    expect(view.creators.every((c) => c.fee === null && c.roas === null)).toBe(true);
    expect(await status(im.sales.createPromoCode(campaignId, { influencerId: maya, code: 'MAYA20' }))).toBe(403);
    expect(await status(im.sales.importFile(brandId, { rows: file() }))).toBe(403);

    const scoped = await staff('scoped', 'GENERAL_MANAGER', [otherBrandId]);
    expect(await status(scoped.sales.forCampaign(campaignId))).toBe(404);
    expect(await status(scoped.sales.importFile(brandId, { dryRun: true, rows: file() }))).toBe(404);
    const code = await prisma.promoCode.findFirstOrThrow({ where: { campaignId } });
    expect(await status(scoped.sales.updatePromoCode(code.id, { isActive: false }))).toBe(404);
  });

  it('undoes a whole file; a code with sales can only be turned off', async () => {
    const code = await prisma.promoCode.findFirstOrThrow({ where: { campaignId, codeKey: 'SARA15' } });
    expect(await status(api.sales.removePromoCode(code.id))).toBe(409);
    const off = await api.sales.updatePromoCode(code.id, { isActive: false });
    expect(off.isActive).toBe(false);

    const imp = await prisma.salesImport.findFirstOrThrow({ where: { brandId, fileName: 'orders.csv' } });
    expect(await api.sales.undoImport(imp.id)).toEqual({ removed: 3 });
    expect(await prisma.sale.count({ where: { importId: imp.id } })).toBe(0);
    const s = await api.sales.forCampaign(campaignId);
    expect(s.recentSales.map((r) => r.orderRef)).toEqual(['#2002']);
  });
});
