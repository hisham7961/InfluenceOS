import {
  requests,
  type BulkResultDTO,
  type BulkRowResultDTO,
  type DeliverableTemplateResultDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { PLATFORMS, parseCsvRecords, type Platform } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { makeCampaignInfluencerService } from './campaign-influencer.service';
import { makeSourcingService } from './sourcing.service';

type BulkRosterAdd = z.infer<typeof requests.bulkRosterAddSchema>;
type DeliverableTemplate = z.infer<typeof requests.deliverableTemplateSchema>;
type CandidateCsvImport = z.infer<typeof requests.candidateCsvImportSchema>;

const PLATFORM_SET = new Set<string>(PLATFORMS);
/** First non-empty value among several candidate header keys. */
function pick(rec: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (v != null && v.trim() !== '') return v.trim();
  }
  return '';
}

/**
 * Bulk campaign-building operations (W3-4) — build a 100-creator campaign in
 * minutes, not hundreds of clicks. Everything here is orchestration over the
 * existing roster/deliverable models (no new tables), and each is resilient:
 * one bad row never aborts the batch.
 */
export function makeBulkService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function campaignOrThrow(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, brandId: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');
    return campaign;
  }

  /**
   * Add many creators to a campaign roster in one request. Each row is attempted
   * independently: a duplicate (already on the roster) is `skipped`, any other
   * error is `failed`, and the rest are `added` — the response reports every
   * row so the client can show exactly what happened.
   */
  async function addInfluencers(campaignId: string, input: BulkRosterAdd): Promise<BulkResultDTO> {
    const actor = requireActor(ctx);
    const campaign = await campaignOrThrow(campaignId);
    const roster = makeCampaignInfluencerService(ctx);

    const results: BulkRowResultDTO[] = [];
    for (const row of input.rows) {
      try {
        const ci = await roster.add({ ...row, campaignId });
        results.push({ influencerId: row.influencerId, label: ci.influencer.displayName, status: 'added', id: ci.id, message: null });
      } catch (err) {
        if (err instanceof AppError && err.code === 'CONFLICT') {
          results.push({ influencerId: row.influencerId, label: null, status: 'skipped', id: null, message: err.message });
        } else {
          const message = err instanceof AppError ? err.message : 'Could not add this creator.';
          results.push({ influencerId: row.influencerId, label: null, status: 'failed', id: null, message });
        }
      }
    }

    const added = results.filter((r) => r.status === 'added').length;
    if (added > 0) {
      await logActivity(ctx, {
        type: 'GENERIC',
        message: `${actor.name} bulk-added ${added} creator${added === 1 ? '' : 's'} to ${campaign.name}.`,
        brandId: campaign.brandId,
        campaignId,
        meta: { added, skipped: results.filter((r) => r.status === 'skipped').length, failed: results.filter((r) => r.status === 'failed').length },
      });
    }
    return {
      added,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  /**
   * Fan a set of deliverables out across a campaign's roster — every member, or
   * an explicit subset (each validated to belong to the campaign). Uses a single
   * `createMany`, so applying 5 deliverables to 100 creators is one insert.
   */
  async function applyDeliverableTemplate(
    campaignId: string,
    input: DeliverableTemplate,
  ): Promise<DeliverableTemplateResultDTO> {
    const actor = requireActor(ctx);
    const campaign = await campaignOrThrow(campaignId);

    const rosterRows = await prisma.campaignInfluencer.findMany({
      where: { campaignId },
      select: { id: true },
    });
    const rosterIds = new Set(rosterRows.map((r) => r.id));

    let targetIds: string[];
    if (input.target === 'all') {
      targetIds = [...rosterIds];
    } else {
      // Every explicit target must belong to this campaign (no cross-campaign writes).
      const unknown = input.target.filter((id) => !rosterIds.has(id));
      if (unknown.length > 0) {
        throw AppError.badRequest('One or more targets are not on this campaign roster.');
      }
      targetIds = input.target;
    }
    if (targetIds.length === 0) throw AppError.badRequest('This campaign has no roster members to apply the template to.');

    const data = targetIds.flatMap((campaignInfluencerId) =>
      input.deliverables.map((d) => ({
        campaignInfluencerId,
        platform: d.platform,
        type: d.type,
        quantity: d.quantity ?? 1,
        dueDate: d.dueDate ?? null,
        requirements: d.requirements ?? null,
        requiredHashtags: d.requiredHashtags ?? [],
        requiredMentions: d.requiredMentions ?? [],
        scriptReferenceId: d.scriptReferenceId ?? null,
        status: d.status ?? ('PLANNED' as const),
        publishedUrl: d.publishedUrl ?? null,
        publishedAt: d.publishedAt ?? null,
        internalNotes: d.internalNotes ?? null,
      })),
    );

    const created = await prisma.deliverable.createMany({ data });
    await logActivity(ctx, {
      type: 'DELIVERABLE_ADDED',
      message: `${actor.name} applied a ${input.deliverables.length}-deliverable template to ${targetIds.length} roster member${targetIds.length === 1 ? '' : 's'} on ${campaign.name}.`,
      brandId: campaign.brandId,
      campaignId,
      meta: { rostersTargeted: targetIds.length, deliverablesCreated: created.count },
    });
    return { rostersTargeted: targetIds.length, deliverablesCreated: created.count };
  }

  /**
   * Import a list of creators from CSV as sourcing candidates. Each row resolves
   * to an existing influencer — matched by (platform, username), else by display
   * name — or a new one is created. The creator is then added to the campaign's
   * sourcing pipeline (CONSIDERING). One malformed row never aborts the import:
   * every row is reported added/skipped/failed.
   */
  async function importCandidatesCsv(campaignId: string, input: CandidateCsvImport): Promise<BulkResultDTO> {
    const actor = requireActor(ctx);
    const campaign = await campaignOrThrow(campaignId);
    const sourcing = makeSourcingService(ctx);
    const records = parseCsvRecords(input.csv);

    const results: BulkRowResultDTO[] = [];
    for (const rec of records) {
      const displayName = pick(rec, 'displayname', 'display name', 'name');
      const username = pick(rec, 'username', 'handle');
      const platformRaw = pick(rec, 'platform').toUpperCase();
      const platform = PLATFORM_SET.has(platformRaw) ? (platformRaw as Platform) : null;
      const label = displayName || username || null;

      if (!displayName && !username) {
        results.push({ influencerId: null, label, status: 'failed', id: null, message: 'Row has no name or username.' });
        continue;
      }

      try {
        // Resolve the influencer: (platform, username) first, then display name.
        let influencer: { id: string } | null = null;
        if (username && platform) {
          influencer = await prisma.influencer.findFirst({
            where: { primaryPlatform: platform, primaryUsername: { equals: username, mode: 'insensitive' } },
            select: { id: true },
          });
        }
        if (!influencer && displayName) {
          influencer = await prisma.influencer.findFirst({
            where: { displayName: { equals: displayName, mode: 'insensitive' } },
            select: { id: true },
          });
        }
        if (!influencer) {
          const email = pick(rec, 'email');
          influencer = await prisma.influencer.create({
            data: {
              displayName: displayName || username,
              fullName: pick(rec, 'fullname', 'full name') || null,
              primaryUsername: username || null,
              primaryPlatform: platform,
              email: email || null,
              category: pick(rec, 'category') || null,
              country: pick(rec, 'country') || null,
            },
            select: { id: true },
          });
        }

        const fitRaw = pick(rec, 'fitscore', 'fit score');
        const parsedFit = Number.parseInt(fitRaw, 10);
        const fitScore = Number.isFinite(parsedFit) ? Math.max(0, Math.min(100, parsedFit)) : null;

        const candidate = await sourcing.add(campaignId, {
          influencerId: influencer.id,
          fitScore,
          notes: pick(rec, 'notes') || null,
        });
        results.push({ influencerId: influencer.id, label, status: 'added', id: candidate.id, message: null });
      } catch (err) {
        if (err instanceof AppError && err.code === 'CONFLICT') {
          results.push({ influencerId: null, label, status: 'skipped', id: null, message: err.message });
        } else {
          const message = err instanceof AppError ? err.message : 'Could not import this row.';
          results.push({ influencerId: null, label, status: 'failed', id: null, message });
        }
      }
    }

    const added = results.filter((r) => r.status === 'added').length;
    if (added > 0) {
      await logActivity(ctx, {
        type: 'GENERIC',
        message: `${actor.name} imported ${added} candidate${added === 1 ? '' : 's'} from CSV into ${campaign.name}.`,
        brandId: campaign.brandId,
        campaignId,
        meta: { added, skipped: results.filter((r) => r.status === 'skipped').length, failed: results.filter((r) => r.status === 'failed').length },
      });
    }
    return {
      added,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  return { addInfluencers, applyDeliverableTemplate, importCandidatesCsv };
}

export type BulkService = ReturnType<typeof makeBulkService>;
