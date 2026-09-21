import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BulkResultDTO, CampaignCandidateDTO, CampaignInfluencerDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-4 — CSV import of creators as sourcing candidates. Existing creators are
 * matched (by handle+platform, then display name); unknown ones are created.
 * Importing never touches the roster or relationship history — it only fills the
 * sourcing pipeline. One malformed row never aborts the import.
 */
describe('W3-4 — candidate CSV import', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let existingId: string;
  const tag = Date.now();

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `CSV Brand ${tag}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `CSV Camp ${tag}` } }));
    // An existing creator that the CSV should MATCH (by handle+platform), not duplicate.
    existingId = idOf(await app.inject({
      method: 'POST', url: '/api/v1/influencers', headers: auth,
      payload: { displayName: `Existing ${tag}`, primaryUsername: `existing_${tag}`, primaryPlatform: 'INSTAGRAM', countryCode: 'KW' },
    }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    // Remove created + matched influencers (match by our unique tag).
    await prisma.influencer.deleteMany({ where: { displayName: { contains: String(tag) } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('imports a CSV: matches an existing creator, creates new ones, and reports a bad row', async () => {
    const csv = [
      'Display Name,username,platform,fitScore,notes,country',
      `Existing ${tag},existing_${tag},INSTAGRAM,70,known face`, // matches existing → added candidate (no new influencer)
      `"New, One ${tag}",new_one_${tag},TIKTOK,85,"strong, on-brand",Kuwait`, // created
      `New Two ${tag},,,,,Kuwait,`, // created (no handle) — trailing extra cell ignored
      ',,,,', // no name/username → failed
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/candidates/import`,
      headers: auth,
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as BulkResultDTO;
    expect(out.added).toBe(3);
    expect(out.failed).toBe(1);
    expect(out.results.find((r) => r.status === 'failed')?.message).toMatch(/no name/i);

    // The existing creator was matched, not duplicated.
    const candidates = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth })).json() as CampaignCandidateDTO[];
    expect(candidates).toHaveLength(3);
    const matched = candidates.find((c) => c.influencer.id === existingId);
    expect(matched).toBeTruthy();
    expect(matched!.fitScore).toBe(70);

    // Importing does NOT create any roster row.
    const roster = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })).json() as CampaignInfluencerDTO[];
    expect(roster).toHaveLength(0);
  });

  it('is idempotent: re-importing the same rows skips existing candidates', async () => {
    const csv = [
      'name,username,platform',
      `Existing ${tag},existing_${tag},INSTAGRAM`,
    ].join('\n');
    const out = (await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates/import`, headers: auth, payload: { csv } })).json() as BulkResultDTO;
    expect(out.added).toBe(0);
    expect(out.skipped).toBe(1);
  });
});
