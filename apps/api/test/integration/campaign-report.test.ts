import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignDetailDTO, CampaignReportDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/** Read the entries of a .zip (the .xlsx container) — just enough to check the sheets. */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    i = start + size;
  }
  return files;
}

/**
 * P2.2 — the client report: results against the campaign's targets, per
 * creator and per post, in English or Arabic, as JSON and as an Excel file.
 * Costs appear only for a reader who may see money and hasn't switched them
 * off; another brand's user can't read it.
 */
describe('P2.2 — client campaign report', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let noFinanceId: string;
  let noFinance: Record<string, string>;
  let otherBrandId: string;
  let otherBrand: Record<string, string>;
  let brandId: string;
  let brandB: string;
  let campaignId: string;
  const tag = `RPT${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  async function createUser(
    label: string,
    roleProfile?: string,
  ): Promise<{ userId: string; auth: Record<string, string> }> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `${tag.toLowerCase()}_${label}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} ${label}`,
        role: 'STAFF',
        roleProfile: (roleProfile ?? null) as never,
        passwordHash: await hash(password),
      },
    });
    await prisma.$disconnect();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
    return { userId: user.id, auth: { authorization: `Bearer ${tokens.accessToken}` } };
  }

  beforeAll(async () => {
    app = await makeApp();
    ({ auth: admin, userId: adminId } = await loginFresh(app));
    brandId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/brands',
        headers: admin,
        payload: { name: `${tag} Brand` },
      }),
    );
    brandB = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/brands',
        headers: admin,
        payload: { name: `${tag} Other` },
      }),
    );
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: admin,
        payload: {
          brandId,
          name: `${tag} Summer`,
          plannedBudget: 1000,
          targetViews: 100000,
          targetEngagements: 5000,
          targetEngagementRate: 5,
          targetCostPerView: 0.01,
          reportSummary: 'Strong first week.',
        },
      }),
    );
    const makeCreator = async (name: string, fee: number) => {
      const influencerId = idOf(
        await app.inject({
          method: 'POST',
          url: '/api/v1/influencers',
          headers: admin,
          payload: { displayName: `${tag} ${name}`, countryCode: 'KW' },
        }),
      );
      const row = idOf(
        await app.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignId}/influencers`,
          headers: admin,
          payload: { influencerId, dealType: 'PAID', agreedCost: fee },
        }),
      );
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${row}/deliverables`,
        headers: admin,
        payload: { platform: 'SNAPCHAT', type: 'STORY', quantity: 2 },
      });
      return influencerId;
    };
    const noor = await makeCreator('Noor', 600);
    const sara = await makeCreator('Sara', 200);
    const post = async (influencerId: string, n: string, views: number, likes: number) => {
      const id = idOf(
        await app.inject({
          method: 'POST',
          url: '/api/v1/content',
          headers: admin,
          payload: {
            url: `https://www.snapchat.com/spotlight/${tag}${n}`,
            campaignId,
            influencerId,
          },
        }),
      );
      await app.inject({
        method: 'POST',
        url: `/api/v1/content/${id}/metrics`,
        headers: admin,
        payload: { views, likes },
      });
    };
    await post(noor, 'a', 40000, 2000);
    await post(noor, 'b', 20000, 1000);
    await post(sara, 'c', 20000, 1000);

    ({ userId: noFinanceId, auth: noFinance } = await createUser('ops', 'OPERATIONS_MANAGER'));
    ({ userId: otherBrandId, auth: otherBrand } = await createUser('brand-b'));
    await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${otherBrandId}/brand-access`,
      headers: admin,
      payload: { brandIds: [brandB] },
    });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign
      .deleteMany({ where: { brandId: { in: [brandId, brandB] } } })
      .catch(() => undefined);
    await prisma.brandInfluencer
      .deleteMany({ where: { brandId: { in: [brandId, brandB] } } })
      .catch(() => undefined);
    await prisma.brand
      .deleteMany({ where: { id: { in: [brandId, brandB] } } })
      .catch(() => undefined);
    await prisma.influencer
      .deleteMany({ where: { displayName: { startsWith: tag } } })
      .catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(noFinanceId);
    await deleteUser(otherBrandId);
    await deleteUser(adminId);
  });

  it('keeps the targets on the campaign', async () => {
    const c = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}`, headers: admin })
    ).json() as CampaignDetailDTO;
    expect(c.targetViews).toBe(100000);
    expect(c.targetEngagementRate).toBe(5);
    expect(c.targetCostPerView).toBeCloseTo(0.01);
    expect(c.reportSummary).toBe('Strong first week.');
  });

  it('sets the results against the targets, per creator and per post', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campaignId}/report?locale=en`,
      headers: admin,
    });
    expect(res.statusCode).toBe(200);
    const r = res.json() as CampaignReportDTO;
    expect(r.includeCosts).toBe(true);
    expect(r.summary).toBe('Strong first week.');
    expect(r.totals.creators).toBe(2);
    expect(r.totals.postsPlanned).toBe(4);
    expect(r.totals.postsLive).toBe(3);
    expect(r.totals.views).toEqual({ actual: 80000, target: 100000, percent: 80 });
    expect(r.totals.engagements.actual).toBe(4000);
    expect(r.totals.engagements.percent).toBe(80);
    expect(r.totals.spend).toBe(800);
    expect(r.totals.plannedBudget).toBe(1000);
    // 800 / 80,000 = 0.01 → exactly on target.
    expect(r.totals.costPerView.actual).toBeCloseTo(0.01);
    expect(r.totals.costPerView.percent).toBe(100);

    const noor = r.creators.find((c) => c.name.endsWith('Noor'))!;
    expect(noor.views).toBe(60000);
    expect(noor.spend).toBe(600);
    expect(noor.postsLive).toBe(2);
    // Best post first.
    expect(r.posts.map((p) => p.views)).toEqual([40000, 20000, 20000]);
    expect(r.posts[0]!.costPerView).toBeCloseTo(0.01);
  });

  it('leaves costs out when asked, and for a reader who may not see money', async () => {
    const off = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${campaignId}/report?costs=false`,
        headers: admin,
      })
    ).json() as CampaignReportDTO;
    expect(off.includeCosts).toBe(false);
    expect(off.totals.spend).toBeNull();
    expect(off.totals.costPerView.actual).toBeNull();
    expect(off.creators.every((c) => c.spend === null && c.costPerView === null)).toBe(true);
    expect(off.posts.every((p) => p.costPerView === null)).toBe(true);
    // Views still there.
    expect(off.totals.views.actual).toBe(80000);

    const ops = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campaignId}/report`,
      headers: noFinance,
    });
    expect(ops.statusCode).toBe(200);
    const opsReport = ops.json() as CampaignReportDTO;
    expect(opsReport.includeCosts).toBe(false);
    expect(opsReport.totals.spend).toBeNull();
  });

  it("refuses another brand's user", async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/campaigns/${campaignId}/report`,
          headers: otherBrand,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/campaigns/${campaignId}/report/xlsx`,
          headers: otherBrand,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('downloads an Excel workbook with Summary, Creators and Posts, in Arabic right to left', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campaignId}/report/xlsx?locale=ar`,
      headers: admin,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(String(res.headers['content-disposition'])).toContain('.xlsx');
    const files = unzip(res.rawPayload);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet3.xml',
      ]),
    );
    expect(files.get('xl/workbook.xml')).toContain('name="الملخص"');
    const summary = files.get('xl/worksheets/sheet1.xml')!;
    expect(summary).toContain('rightToLeft="1"');
    expect(summary).toContain('المشاهدات');
    expect(summary).toContain('<v>80000</v>');
    expect(summary).toContain('Strong first week.');
    const postsSheet = files.get('xl/worksheets/sheet3.xml')!;
    expect(postsSheet).toContain(`spotlight/${tag}a`);

    // English, without costs: no spend column anywhere.
    const en = unzip(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/campaigns/${campaignId}/report/xlsx?locale=en&costs=false`,
          headers: admin,
        })
      ).rawPayload,
    );
    expect(en.get('xl/workbook.xml')).toContain('name="Summary"');
    expect(en.get('xl/worksheets/sheet1.xml')).not.toContain('Spend');
    expect(en.get('xl/worksheets/sheet2.xml')).not.toContain('Cost per view');
  });
});
