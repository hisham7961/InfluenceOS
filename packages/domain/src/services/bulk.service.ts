import {
  requests,
  type BulkPreviewDTO,
  type BulkResultDTO,
  type BulkRowResultDTO,
  type DeliverableTemplateResultDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { normalizeCountryToCode, PLATFORMS, parseCsvRecords, type Platform } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { makeCampaignInfluencerService } from './campaign-influencer.service';
import { makeDataQualityService } from './data-quality.service';
import { makeSourcingService } from './sourcing.service';

type BulkRosterAdd = z.infer<typeof requests.bulkRosterAddSchema>;
type BulkRosterRow = BulkRosterAdd['rows'][number];
type DeliverableTemplate = z.infer<typeof requests.deliverableTemplateSchema>;
type CandidateCsvImport = z.infer<typeof requests.candidateCsvImportSchema>;

/** Read-only plan for one bulk-roster-add row — the single source of truth
 *  both `previewAddInfluencers` and `addInfluencers` (execute) build on. */
interface PlannedAddRow {
  row: BulkRosterRow;
  influencerId: string;
  label: string | null;
  willApply: boolean;
  /** Why this row would NOT apply — drives whether execute reports 'skipped' or 'failed'. Null when willApply. */
  reason: 'notFound' | 'conflict' | null;
  message: string | null;
}

/** Data a CSV row would create a NEW influencer with, if no existing match is found. */
interface CsvCreateData {
  displayName: string;
  fullName: string | null;
  primaryUsername: string | null;
  primaryPlatform: Platform | null;
  email: string | null;
  category: string | null;
  country: string | null;
  countryCode: string;
}

/** Read-only plan for one CSV-import row — the single source of truth both
 *  `previewImportCandidatesCsv` and `importCandidatesCsv` (execute) build on. */
interface PlannedCsvRow {
  label: string | null;
  /** An existing influencer this row resolved to (by platform+username, then display name). */
  existingInfluencerId: string | null;
  /** Set only when no existing influencer matched — what a create would use. */
  createData: CsvCreateData | null;
  /** True when `existingInfluencerId` is already a candidate on this campaign (execute would skip it). */
  alreadyCandidate: boolean;
  fitScore: number | null;
  notes: string | null;
  /** Set when the row is malformed and can never be added (no name/username, or no resolvable country for a new creator). */
  invalid: string | null;
}

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
   * Read-only plan for a bulk roster add — resolves each row against the
   * REAL current state (does influencer exist? are they already on this
   * roster?) without writing anything. `previewAddInfluencers` and
   * `addInfluencers` (execute) both build on this, so the counts a manager
   * confirms in preview can never diverge from what execute actually does —
   * mirrors bulk-influencer.service.ts's plan()/preview()/execute() split.
   */
  async function planAddInfluencers(campaignId: string, input: BulkRosterAdd): Promise<PlannedAddRow[]> {
    await campaignOrThrow(campaignId);
    const influencerIds = input.rows.map((r) => r.influencerId);
    const [influencers, onRosterRows] = await Promise.all([
      prisma.influencer.findMany({ where: { id: { in: influencerIds } }, select: { id: true, displayName: true } }),
      prisma.campaignInfluencer.findMany({ where: { campaignId, influencerId: { in: influencerIds } }, select: { influencerId: true } }),
    ]);
    const byId = new Map(influencers.map((i) => [i.id, i]));
    const onRoster = new Set(onRosterRows.map((r) => r.influencerId));

    return input.rows.map((row) => {
      const inf = byId.get(row.influencerId);
      if (!inf) {
        return { row, influencerId: row.influencerId, label: null, willApply: false, reason: 'notFound', message: 'Influencer not found' };
      }
      if (onRoster.has(row.influencerId)) {
        return {
          row,
          influencerId: row.influencerId,
          label: inf.displayName,
          willApply: false,
          reason: 'conflict',
          message: `${inf.displayName} is already on this campaign.`,
        };
      }
      return { row, influencerId: row.influencerId, label: inf.displayName, willApply: true, reason: null, message: null };
    });
  }

  /** Dry-run preview of a bulk roster add — never writes (gap #6). */
  async function previewAddInfluencers(campaignId: string, input: BulkRosterAdd): Promise<BulkPreviewDTO> {
    requireActor(ctx);
    const rows = await planAddInfluencers(campaignId, input);
    const dtoRows: BulkRowResultDTO[] = rows.map((r) => ({
      influencerId: r.influencerId,
      label: r.label,
      status: r.willApply ? 'added' : 'skipped',
      id: null,
      message: r.message,
    }));
    return {
      selected: rows.length,
      willUpdate: rows.filter((r) => r.willApply).length,
      willSkip: rows.filter((r) => !r.willApply).length,
      rows: dtoRows,
    };
  }

  /**
   * Add many creators to a campaign roster in one request. Each row is planned
   * first (see `planAddInfluencers`, shared with the preview), then rows that
   * would apply are actually written — still wrapped in try/catch so a race
   * (state changing between plan and write) is caught as a real conflict, not
   * a crash. A duplicate (already on the roster) is `skipped`, an unresolvable
   * row is `failed`, and the rest are `added` — the response reports every row
   * so the client can show exactly what happened.
   */
  async function addInfluencers(campaignId: string, input: BulkRosterAdd): Promise<BulkResultDTO> {
    const actor = requireActor(ctx);
    const campaign = await campaignOrThrow(campaignId);
    const roster = makeCampaignInfluencerService(ctx);
    const plannedRows = await planAddInfluencers(campaignId, input);

    const results: BulkRowResultDTO[] = [];
    for (const planned of plannedRows) {
      if (!planned.willApply) {
        results.push({
          influencerId: planned.influencerId,
          label: planned.label,
          status: planned.reason === 'notFound' ? 'failed' : 'skipped',
          id: null,
          message: planned.message,
        });
        continue;
      }
      try {
        const ci = await roster.add({ ...planned.row, campaignId });
        results.push({ influencerId: planned.influencerId, label: ci.influencer.displayName, status: 'added', id: ci.id, message: null });
      } catch (err) {
        if (err instanceof AppError && err.code === 'CONFLICT') {
          results.push({ influencerId: planned.influencerId, label: planned.label, status: 'skipped', id: null, message: err.message });
        } else {
          const message = err instanceof AppError ? err.message : 'Could not add this creator.';
          results.push({ influencerId: planned.influencerId, label: planned.label, status: 'failed', id: null, message });
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
   * Resolves one CSV row against the REAL current state — same
   * (platform, username) then display-name match the execute path uses —
   * without writing anything. Shared by `planImportCandidatesCsv` (and so by
   * both preview and execute) so the resolution logic can never drift.
   */
  async function planCsvRow(rec: Record<string, string>): Promise<PlannedCsvRow> {
    const displayName = pick(rec, 'displayname', 'display name', 'name');
    const username = pick(rec, 'username', 'handle');
    const platformRaw = pick(rec, 'platform').toUpperCase();
    const platform = PLATFORM_SET.has(platformRaw) ? (platformRaw as Platform) : null;
    const label = displayName || username || null;

    if (!displayName && !username) {
      return { label, existingInfluencerId: null, createData: null, alreadyCandidate: false, fitScore: null, notes: null, invalid: 'Row has no name or username.' };
    }

    const fitRaw = pick(rec, 'fitscore', 'fit score');
    const parsedFit = Number.parseInt(fitRaw, 10);
    const fitScore = Number.isFinite(parsedFit) ? Math.max(0, Math.min(100, parsedFit)) : null;
    const notes = pick(rec, 'notes') || null;

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
    if (influencer) {
      return { label, existingInfluencerId: influencer.id, createData: null, alreadyCandidate: false, fitScore, notes, invalid: null };
    }

    // countryCode is required on every new influencer (drives country
    // scoping and the directory's country filter) — same rule
    // influencerCreateSchema enforces for the single-add form, so a CSV
    // import can never create an unfilterable creator either.
    const countryRaw = pick(rec, 'country', 'countrycode');
    const countryCodeResolved = normalizeCountryToCode(countryRaw);
    if (!countryCodeResolved) {
      const invalid = countryRaw
        ? `Country "${countryRaw}" was not recognized — use a country name or ISO code (e.g. Kuwait or KW).`
        : 'A Country column is required to add a new creator.';
      return { label, existingInfluencerId: null, createData: null, alreadyCandidate: false, fitScore, notes, invalid };
    }

    return {
      label,
      existingInfluencerId: null,
      createData: {
        displayName: displayName || username,
        fullName: pick(rec, 'fullname', 'full name') || null,
        primaryUsername: username || null,
        primaryPlatform: platform,
        email: pick(rec, 'email') || null,
        category: pick(rec, 'category') || null,
        country: countryRaw || null,
        countryCode: countryCodeResolved,
      },
      alreadyCandidate: false,
      fitScore,
      notes,
      invalid: null,
    };
  }

  /**
   * Read-only plan for a CSV candidate import — parses the CSV and resolves
   * every row against the real current state, without writing anything.
   * `previewImportCandidatesCsv` and `importCandidatesCsv` (execute) both
   * build on this single pass, so a preview's row-by-row outcome (and the
   * exact influencer a create-branch row would create) can never drift from
   * what execute actually does.
   */
  async function planImportCandidatesCsv(campaignId: string, input: CandidateCsvImport): Promise<PlannedCsvRow[]> {
    await campaignOrThrow(campaignId);
    const records = parseCsvRecords(input.csv);
    const rows: PlannedCsvRow[] = [];
    for (const rec of records) rows.push(await planCsvRow(rec));

    // A row that resolved to an existing influencer may already be a
    // candidate on this campaign — check in one batched, read-only query
    // (execute still re-checks for real via sourcing.add()'s own conflict
    // detection, so a race between plan and write is still caught).
    const existingIds = rows.map((r) => r.existingInfluencerId).filter((id): id is string => id != null);
    if (existingIds.length > 0) {
      const already = await prisma.campaignCandidate.findMany({
        where: { campaignId, influencerId: { in: existingIds } },
        select: { influencerId: true },
      });
      const alreadySet = new Set(already.map((c) => c.influencerId));
      for (const r of rows) {
        if (r.existingInfluencerId && alreadySet.has(r.existingInfluencerId)) r.alreadyCandidate = true;
      }
    }
    return rows;
  }

  /**
   * Dry-run preview of a CSV candidate import (gap #7) — never creates an
   * influencer or a candidate. For every row that would CREATE a new
   * influencer (no existing match found), also runs duplicate detection
   * (data-quality.service's `checkDuplicate`, the same single-candidate check
   * the manual Add Influencer flow runs — gap #4) and surfaces any match as
   * an advisory warning in the row's `message`. This is advisory only: a
   * possible duplicate never auto-skips or auto-merges the row — execute
   * still creates it exactly as it does today, unless the person reviewing
   * the preview fixes the CSV first.
   */
  async function previewImportCandidatesCsv(campaignId: string, input: CandidateCsvImport): Promise<BulkPreviewDTO> {
    requireActor(ctx);
    const plannedRows = await planImportCandidatesCsv(campaignId, input);
    const dataQuality = makeDataQualityService(ctx);

    let willCreate = 0;
    const dtoRows: BulkRowResultDTO[] = [];
    for (const r of plannedRows) {
      if (r.invalid) {
        dtoRows.push({ influencerId: null, label: r.label, status: 'skipped', id: null, message: r.invalid });
        continue;
      }
      if (r.existingInfluencerId) {
        dtoRows.push(
          r.alreadyCandidate
            ? { influencerId: r.existingInfluencerId, label: r.label, status: 'skipped', id: null, message: 'Already a candidate on this campaign.' }
            : { influencerId: r.existingInfluencerId, label: r.label, status: 'added', id: null, message: null },
        );
        continue;
      }

      // This row would create a new influencer — advisory-only duplicate check.
      willCreate++;
      let message: string | null = null;
      if (r.createData) {
        const matches = await dataQuality.checkDuplicate({
          displayName: r.createData.displayName,
          platform: r.createData.primaryPlatform ?? undefined,
          username: r.createData.primaryUsername ?? undefined,
          email: r.createData.email ?? undefined,
        });
        if (matches.length > 0) {
          const top = matches[0]!;
          const fields = top.reasons.map((reason) => reason.field).join(', ');
          const extra = matches.length > 1 ? ` (+${matches.length - 1} more possible match${matches.length - 1 === 1 ? '' : 'es'})` : '';
          message = `Possible duplicate of "${top.displayName}" (${top.confidence} match on ${fields}) — will still create a new influencer unless you fix the row${extra}`;
        }
      }
      dtoRows.push({ influencerId: null, label: r.label, status: 'added', id: null, message });
    }

    return {
      selected: dtoRows.length,
      willUpdate: dtoRows.filter((r) => r.status === 'added').length,
      willSkip: dtoRows.filter((r) => r.status === 'skipped').length,
      willCreate,
      rows: dtoRows,
    };
  }

  /**
   * Import a list of creators from CSV as sourcing candidates. Each row resolves
   * to an existing influencer — matched by (platform, username), else by display
   * name — or a new one is created (see `planCsvRow`, shared with the preview —
   * the exact same data a create-branch row previewed is what gets created
   * here). The creator is then added to the campaign's sourcing pipeline
   * (CONSIDERING). One malformed row never aborts the import: every row is
   * reported added/skipped/failed.
   */
  async function importCandidatesCsv(campaignId: string, input: CandidateCsvImport): Promise<BulkResultDTO> {
    const actor = requireActor(ctx);
    const campaign = await campaignOrThrow(campaignId);
    const sourcing = makeSourcingService(ctx);
    const plannedRows = await planImportCandidatesCsv(campaignId, input);

    const results: BulkRowResultDTO[] = [];
    for (const r of plannedRows) {
      if (r.invalid) {
        results.push({ influencerId: null, label: r.label, status: 'failed', id: null, message: r.invalid });
        continue;
      }

      try {
        let influencerId = r.existingInfluencerId;
        if (!influencerId && r.createData) {
          const created = await prisma.influencer.create({ data: { ...r.createData }, select: { id: true } });
          influencerId = created.id;
        }
        if (!influencerId) {
          // Defensive: planCsvRow always resolves to either an existing match
          // or createData when `invalid` is null — this should be unreachable.
          results.push({ influencerId: null, label: r.label, status: 'failed', id: null, message: 'Could not resolve this row.' });
          continue;
        }

        const candidate = await sourcing.add(campaignId, {
          influencerId,
          fitScore: r.fitScore,
          notes: r.notes,
        });
        results.push({ influencerId, label: r.label, status: 'added', id: candidate.id, message: null });
      } catch (err) {
        if (err instanceof AppError && err.code === 'CONFLICT') {
          results.push({ influencerId: null, label: r.label, status: 'skipped', id: null, message: err.message });
        } else {
          const message = err instanceof AppError ? err.message : 'Could not import this row.';
          results.push({ influencerId: null, label: r.label, status: 'failed', id: null, message });
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

  return { addInfluencers, previewAddInfluencers, applyDeliverableTemplate, importCandidatesCsv, previewImportCandidatesCsv };
}

export type BulkService = ReturnType<typeof makeBulkService>;
