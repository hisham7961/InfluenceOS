import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignDetailDTO, CalendarEventDTO, CostSummaryDTO, ExecDashboardDTO, GlobalDashboardDTO, InfluencerDetailDTO } from '@influenceos/contracts';
import { addBusinessDays, businessDateKey } from '@influenceos/shared';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P1.2 — one set of rules for "overdue", "delivered" and "spend", in Kuwait
 * time, shared by every screen, report and the worker.
 */
describe('P1.2 — shared business rules (Kuwait time)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const cleanupUsers: string[] = [];
  const brands: string[] = [];
  const tag = `BR${Date.now()}`;
  const today = businessDateKey(new Date());
  const yesterday = addBusinessDays(today, -1);
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth, payload: payload as object });
  const get = async <T>(url: string, headers = auth) => (await app.inject({ method: 'GET', url: `/api/v1${url}`, headers })).json() as T;

  async function brand(name: string) {
    const id = idOf(await post('/brands', { name: `${tag} ${name}` }));
    brands.push(id);
    return id;
  }
  async function campaign(brandId: string, name: string, extra: object = {}) {
    return idOf(await post('/campaigns', { brandId, name: `${tag} ${name}`, ...extra }));
  }
  async function creator(name: string) {
    return idOf(await post('/influencers', { displayName: `${tag} ${name}`, countryCode: 'KW' }));
  }
  async function roster(campaignId: string, influencerId: string, extra: object = { dealType: 'FREE' }) {
    const res = await post(`/campaigns/${campaignId}/influencers`, { influencerId, ...extra });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return idOf(res);
  }
  async function deliverable(ciId: string, fields: { type?: string; status?: string; dueDate?: string }) {
    const res = await post(`/campaign-influencers/${ciId}/deliverables`, { platform: 'INSTAGRAM', type: 'REEL', ...fields });
    expect(res.statusCode, res.body).toBeLessThan(300);
  }

  beforeAll(async () => {
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: brands } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brands } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    for (const id of [userId, ...cleanupUsers]) await deleteUser(id);
  });

  it('calls work overdue only after its whole due day has passed in Kuwait, and only while it is still owed', async () => {
    const b = await brand('Overdue');
    const c = await campaign(b, 'Overdue');
    const ci = await roster(c, await creator('Overdue'));
    await deliverable(ci, { dueDate: today }); // due today: not overdue yet
    await deliverable(ci, { dueDate: yesterday }); // overdue
    await deliverable(ci, { dueDate: yesterday, status: 'APPROVED', type: 'REEL' }); // approved but not posted: overdue
    await deliverable(ci, { dueDate: yesterday, status: 'APPROVED', type: 'UGC' }); // UGC approved = delivered
    await deliverable(ci, { dueDate: yesterday, status: 'CANCELLED' }); // off the plan
    await deliverable(ci, { dueDate: yesterday, status: 'PUBLISHED' });

    const pulse = (await get<GlobalDashboardDTO>(`/dashboard/global?brandId=${b}`)).pulse;
    expect(pulse.overdueDeliverables).toBe(2);
    expect(pulse.upcomingDeliverables).toBe(1);

    const exec = await get<ExecDashboardDTO>(`/reports/exec-dashboard?brandId=${b}`);
    expect(exec.today.deliverablesDue).toBe(1);
    expect(exec.brands.find((x) => x.brandId === b)?.overdueDeliverables).toBe(2);
  });

  it('leaves cancelled work out of completion and counts approval as delivery only for UGC', async () => {
    const b = await brand('Completion');
    const c = await campaign(b, 'Completion');
    const ci = await roster(c, await creator('Completion'));
    await deliverable(ci, { status: 'PUBLISHED' });
    await deliverable(ci, { status: 'CANCELLED' });
    await deliverable(ci, { status: 'APPROVED', type: 'UGC' });
    await deliverable(ci, { status: 'APPROVED', type: 'STORY' });

    const detail = await get<CampaignDetailDTO>(`/campaigns/${c}`);
    expect(detail.progress.deliverablesTotal).toBe(3);
    expect(detail.progress.deliverablesPublished).toBe(2);
    expect(detail.progress.deliverableCompletion).toBe(67);

    const rows = await get<{ deliverableProgress: { published: number; total: number } }[]>(`/campaigns/${c}/influencers`);
    expect(rows[0]!.deliverableProgress).toEqual({ published: 2, total: 3 });
  });

  it('adds up spend once: no fee twice, and only what was paid to a creator who dropped out', async () => {
    const b = await brand('Spend');
    const c = await campaign(b, 'Spend');
    const onBoard = await roster(c, await creator('OnBoard'), {
      dealType: 'PAID',
      agreedCost: 1000,
      participationStatus: 'CONFIRMED',
      paymentStatus: 'UNPAID',
    });
    const droppedCreator = await creator('Dropped');
    await roster(c, droppedCreator, {
      dealType: 'PAID',
      agreedCost: 500,
      participationStatus: 'DROPPED',
      paymentStatus: 'PARTIALLY_PAID',
      paidAmount: 100,
    });

    // A second record of the same fee is refused…
    const repeat = await post(`/campaigns/${c}/expenses`, { type: 'INFLUENCER_FEE', amount: 1000, campaignInfluencerId: onBoard });
    expect(repeat.statusCode).toBe(409);
    // …and one entered before the rule existed is not counted.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaignExpense.create({
      data: { campaignId: c, campaignInfluencerId: onBoard, type: 'INFLUENCER_FEE', amount: 1000, currency: 'KWD', paymentStatus: 'UNPAID' },
    });
    await prisma.$disconnect();
    expect((await post(`/campaigns/${c}/expenses`, { type: 'PRODUCTION', amount: 200 })).statusCode).toBe(201);

    const detail = await get<CampaignDetailDTO>(`/campaigns/${c}`);
    expect(detail.progress.spend).toBe(1300); // 1000 fee + 100 actually paid to the dropped creator + 200 production

    const costs = await get<{ summary: CostSummaryDTO }>(`/campaigns/${c}/costs`);
    expect(costs.summary.totalSpend).toBe(1300);
    expect(costs.summary.paid).toBe(100);
    expect(costs.summary.unpaid).toBe(1200);

    const pulse = (await get<GlobalDashboardDTO>(`/dashboard/global?brandId=${b}`)).pulse;
    expect(pulse.totalSpend).toBe(1300);

    // "Total paid" counts part payments.
    const inf = await get<InfluencerDetailDTO>(`/influencers/${droppedCreator}`);
    expect(inf.history.totalPaid).toBe(100);
  });

  it('includes the whole last day of a report range (Kuwait time)', async () => {
    const b = await brand('Report');
    const c = await campaign(b, 'Report');
    const infl = await creator('Report');
    await roster(c, infl);
    const day = '2026-03-15';
    // 23:30 in Kuwait on the 15th — after 00:00 UTC, where the range used to stop.
    const res = await post('/content', {
      url: `https://www.snapchat.com/spotlight/${tag}late`,
      campaignId: c,
      influencerId: infl,
      publishedAt: '2026-03-15T20:30:00.000Z',
    });
    expect(res.statusCode, res.body).toBe(201);
    const report = await get<{ rows: unknown[] }>(`/reports?type=content&campaignId=${c}&from=${day}&to=${day}`);
    expect(report.rows).toHaveLength(1);
    const before = await get<{ rows: unknown[] }>(`/reports?type=content&campaignId=${c}&from=2026-03-14&to=2026-03-14`);
    expect(before.rows).toHaveLength(0);
  });

  it("keeps the calendar inside a scoped user's brands", async () => {
    const mine = await brand('Cal Mine');
    const other = await brand('Cal Other');
    const start = '2026-05-10';
    const cMine = await campaign(mine, 'Cal Mine', { startDate: start });
    const cOther = await campaign(other, 'Cal Other', { startDate: start });

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `cal_${Date.now()}@example.test`;
    const staff = await prisma.user.create({ data: { email, name: 'Cal Staff', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') } });
    await prisma.$disconnect();
    cleanupUsers.push(staff.id);
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.id}/brand-access`, headers: auth, payload: { brandIds: [mine] } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    const staffAuth = { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };

    const url = `/calendar?from=2026-05-01&to=2026-05-31`;
    const campaignsSeen = (events: CalendarEventDTO[]) => new Set(events.map((e) => e.campaignId));
    const asStaff = campaignsSeen(await get<CalendarEventDTO[]>(url, staffAuth));
    expect(asStaff.has(cMine)).toBe(true);
    expect(asStaff.has(cOther)).toBe(false);
    const asAdmin = campaignsSeen(await get<CalendarEventDTO[]>(url));
    expect(asAdmin.has(cOther)).toBe(true);
  });
});
