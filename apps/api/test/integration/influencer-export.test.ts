import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InfluencerExportRowDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Influencer data export — proves the directory can be exported as a file. It
 * verifies the CSV wire form (headers + attachment disposition), that the
 * export honors the same filters the directory uses, the structured JSON form,
 * and that it is auth-gated.
 */
describe('Influencer data export (CSV/JSON)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let alphaId: string;
  let betaId: string;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const alphaName = `ExportAlpha ${stamp}`;
  const betaName = `ExportBeta ${stamp}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;

    alphaId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: {
          displayName: alphaName,
          fullName: 'Alpha Full',
          country: 'Kuwait',
          category: 'Lifestyle',
          relationshipStatus: 'ACTIVE',
          email: 'alpha@example.test',
          languages: ['ar', 'en'],
          tags: ['vip', 'gcc'],
        },
      }),
    );
    // A social account so platform/reach columns are exercised.
    await app.inject({
      method: 'POST',
      url: `/api/v1/influencers/${alphaId}/social-accounts`,
      headers: auth,
      payload: { platform: 'INSTAGRAM', username: `alpha_${stamp}`, followers: 12345, isPrimary: true },
    });

    betaId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: betaName, relationshipStatus: 'PROSPECT' },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    for (const id of [alphaId, betaId]) {
      await prisma.socialAccount.deleteMany({ where: { influencerId: id } }).catch(() => undefined);
      await prisma.influencerTag.deleteMany({ where: { influencerId: id } }).catch(() => undefined);
      await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('exports as a CSV attachment with a header row and both influencers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/influencers/export', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('influenceos-influencers.csv');

    const body = res.body;
    const header = body.split('\n')[0];
    expect(header).toContain('Display Name');
    expect(header).toContain('Total Followers');
    expect(header).toContain('Email');
    expect(body).toContain(alphaName);
    expect(body).toContain(betaName);
    // Alpha's reach + platform + a comma-safe tag join are present.
    expect(body).toContain('12345');
    expect(body).toContain('INSTAGRAM');
    expect(body).toContain('alpha@example.test');
  });

  it('honors the directory filters (q narrows the export)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/influencers/export?q=${encodeURIComponent(alphaName)}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(alphaName);
    expect(res.body).not.toContain(betaName);
  });

  it('filters by relationshipStatus', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/influencers/export?q=${encodeURIComponent(stamp)}&relationshipStatus=PROSPECT`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(betaName);
    expect(res.body).not.toContain(alphaName);
  });

  it('returns structured rows with format=json', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/influencers/export?q=${encodeURIComponent(alphaName)}&format=json`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as InfluencerExportRowDTO[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.displayName).toBe(alphaName);
    expect(row.totalFollowers).toBe(12345);
    expect(row.platforms).toContain('INSTAGRAM');
    expect(row.tags.split('; ').sort()).toEqual(['gcc', 'vip']);
    expect(row.languages).toContain('ar');
    expect(row.relationshipStatus).toBe('ACTIVE');
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/influencers/export' });
    expect(res.statusCode).toBe(401);
  });
});
