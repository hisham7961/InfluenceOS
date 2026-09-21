import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  BulkPreviewDTO,
  BulkResultDTO,
  CampaignCandidateDTO,
  CampaignInfluencerDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-4 gaps #6/#7 (+ part of #4) — Preview → Execute for the campaign-roster
 * bulk add and the CSV candidate import, mirroring the canonical
 * plan()/preview()/execute() split proven by bulk-influencer.service.ts:
 * preview must never write, and a preview's outcome for a given row must
 * exactly match what execute then does against the same real state. The CSV
 * preview also gets an advisory duplicate-detection warning (data-quality
 * service's checkDuplicate) for any row that would create a brand-new
 * influencer matching an existing one.
 */
describe('W3-4 — bulk roster-add + CSV-import preview', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let influencerIds: string[] = [];
  const tag = Date.now();

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Preview Brand ${tag}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Preview Camp ${tag}` } }),
    );
    influencerIds.push(
      idOf(
        await app.inject({
          method: 'POST',
          url: '/api/v1/influencers',
          headers: auth,
          payload: { displayName: `Preview Inf A ${tag}`, countryCode: 'KW' },
        }),
      ),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaignCandidate.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    for (const id of influencerIds) await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: String(tag) } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('roster-add preview then execute: a not-yet-on-roster influencer previews and executes as added', async () => {
    const influencerId = influencerIds[0]!;

    const previewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers/bulk/preview`,
      headers: auth,
      payload: { rows: [{ influencerId, dealType: 'PAID' }] },
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as BulkPreviewDTO;
    expect(preview.selected).toBe(1);
    expect(preview.willUpdate).toBe(1);
    expect(preview.willSkip).toBe(0);
    expect(preview.rows[0]!.status).toBe('added');

    // Preview must never write — the roster is still empty.
    const rosterBefore = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })
    ).json() as CampaignInfluencerDTO[];
    expect(rosterBefore).toHaveLength(0);

    const executeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers/bulk`,
      headers: auth,
      payload: { rows: [{ influencerId, dealType: 'PAID' }] },
    });
    expect(executeRes.statusCode).toBe(200);
    const result = executeRes.json() as BulkResultDTO;
    expect(result.added).toBe(1);
    expect(result.results[0]!.status).toBe('added');

    const rosterAfter = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })
    ).json() as CampaignInfluencerDTO[];
    expect(rosterAfter).toHaveLength(1);
  });

  it('roster-add preview then execute: an already-on-roster influencer previews and executes as skipped, both times', async () => {
    const influencerId = influencerIds[0]!; // now on the roster from the previous test

    const previewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers/bulk/preview`,
      headers: auth,
      payload: { rows: [{ influencerId, dealType: 'PAID' }] },
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as BulkPreviewDTO;
    expect(preview.willUpdate).toBe(0);
    expect(preview.willSkip).toBe(1);
    expect(preview.rows[0]!.status).toBe('skipped');

    const executeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers/bulk`,
      headers: auth,
      payload: { rows: [{ influencerId, dealType: 'PAID' }] },
    });
    expect(executeRes.statusCode).toBe(200);
    const result = executeRes.json() as BulkResultDTO;
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]!.status).toBe('skipped');

    // Still exactly one roster row — execute did not double-add.
    const roster = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })
    ).json() as CampaignInfluencerDTO[];
    expect(roster).toHaveLength(1);
  });

  it('CSV-import preview is side-effect-free: no influencer or candidate is created by preview alone', async () => {
    const csv = ['displayName,country', `New Preview Creator ${tag},Kuwait`].join('\n');

    const previewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/candidates/import/preview`,
      headers: auth,
      payload: { csv },
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as BulkPreviewDTO;
    expect(preview.willUpdate).toBe(1);
    expect(preview.rows[0]!.status).toBe('added');

    // No new influencer was created.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const created = await prisma.influencer.findFirst({ where: { displayName: `New Preview Creator ${tag}` } });
    expect(created).toBeNull();
    await prisma.$disconnect();

    // No candidate landed on the campaign's sourcing pipeline either.
    const candidates = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth })
    ).json() as CampaignCandidateDTO[];
    expect(candidates).toHaveLength(0);
  });

  it('CSV-import preview surfaces a duplicate warning for a row that would create a new influencer matching an existing one by email', async () => {
    const dupEmail = `dup_${tag}@example.test`;
    const existingId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `Email Dup Existing ${tag}`, email: dupEmail, countryCode: 'KW' },
      }),
    );
    influencerIds.push(existingId);

    // Different display name/no username, so the (platform, username) and
    // display-name match paths both miss — this row resolves as "would
    // create a new influencer", which is exactly when the duplicate check runs.
    const csv = ['displayName,email,country', `Totally Different Name ${tag},${dupEmail},Kuwait`].join('\n');

    const previewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/candidates/import/preview`,
      headers: auth,
      payload: { csv },
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as BulkPreviewDTO;
    expect(preview.willCreate).toBe(1);
    const row = preview.rows[0]!;
    // Still advisory-only: the row is reported as would-add, never auto-skipped.
    expect(row.status).toBe('added');
    expect(row.message).toBeTruthy();
    expect(row.message).toMatch(/duplicate/i);
    expect(row.message).toContain(`Email Dup Existing ${tag}`);
    expect(row.message).toMatch(/exact/i);

    // Still side-effect-free — no new influencer created, even with a warning.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const created = await prisma.influencer.findFirst({ where: { displayName: `Totally Different Name ${tag}` } });
    expect(created).toBeNull();
    await prisma.$disconnect();

    // Executing for real still creates it (advisory never auto-skips) — confirms
    // execute's behavior is unchanged by the preview-only duplicate signal.
    const executeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/candidates/import`,
      headers: auth,
      payload: { csv },
    });
    expect(executeRes.statusCode).toBe(200);
    const result = executeRes.json() as BulkResultDTO;
    expect(result.added).toBe(1);
  });
});
