import { requests, type BulkPreviewDTO, type BulkResultDTO, type BulkRowResultDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireAdmin } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { isCountryOutOfScope, scopedCountryCodes } from '../lib/scope';

type BulkInfluencerRequest = z.infer<typeof requests.bulkInfluencerRequestSchema>;

interface PlannedRow {
  influencerId: string;
  label: string | null;
  /** True when the write would actually change something. */
  willApply: boolean;
  message: string | null;
}

/**
 * Bulk influencer-directory operations (Operations Intelligence pass, PART
 * 52-54) — apply an action to a saved-view-sized selection of creators at
 * once. `plan()` is the single source of truth both `preview()` and
 * `execute()` build on, so the counts a manager confirms in preview are
 * exactly what happens on execute (never two divergent code paths).
 * SET_RELATIONSHIP_STATUS targets Influencer.relationshipStatus (the same
 * global field the single-influencer edit form sets) — not the per-brand
 * BrandInfluencer.relationshipStatus, since a directory-wide selection has
 * no single brand to scope that to.
 */
export function makeBulkInfluencerService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function planAssignOwner(influencerIds: string[], ownerId: string, countryScope: string[] | null): Promise<PlannedRow[]> {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, isActive: true } });
    if (!owner || !owner.isActive) throw AppError.badRequest('That owner account does not exist or is inactive.');

    const rows = await prisma.influencer.findMany({ where: { id: { in: influencerIds } }, select: { id: true, displayName: true, ownerId: true, countryCode: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return influencerIds.map((id) => {
      const inf = byId.get(id);
      // Security & Authorization Freeze Gate — every row in a bulk operation
      // needs its OWN scope check. A country-scoped actor must not reach
      // (or even learn the display name of) an out-of-scope creator just by
      // naming its id in a directory-wide bulk selection. Masked identically
      // to a truly-missing influencer, mirroring influencer.service.ts's own
      // direct-ID scope check (detail()), so preview never leaks more than a
      // capability-less/out-of-scope caller should see.
      if (!inf || isCountryOutOfScope(countryScope, inf.countryCode)) return { influencerId: id, label: null, willApply: false, message: 'Influencer not found' };
      if (inf.ownerId === ownerId) return { influencerId: id, label: inf.displayName, willApply: false, message: 'Already assigned to this owner' };
      return { influencerId: id, label: inf.displayName, willApply: true, message: null };
    });
  }

  async function planAddTag(influencerIds: string[], tagId: string | null, countryScope: string[] | null): Promise<PlannedRow[]> {
    // tagId is null when the named tag doesn't exist yet (planning must never
    // create it — see findTagId, below) — filter on a sentinel that can never
    // match a real tag id, rather than branching the select shape.
    const rows = await prisma.influencer.findMany({
      where: { id: { in: influencerIds } },
      select: { id: true, displayName: true, countryCode: true, tags: { where: { tagId: tagId ?? '__no-such-tag__' }, select: { id: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return influencerIds.map((id) => {
      const inf = byId.get(id);
      if (!inf || isCountryOutOfScope(countryScope, inf.countryCode)) return { influencerId: id, label: null, willApply: false, message: 'Influencer not found' };
      if (inf.tags.length > 0) return { influencerId: id, label: inf.displayName, willApply: false, message: 'Already tagged' };
      return { influencerId: id, label: inf.displayName, willApply: true, message: null };
    });
  }

  async function planSetRelationshipStatus(influencerIds: string[], status: string, countryScope: string[] | null): Promise<PlannedRow[]> {
    const rows = await prisma.influencer.findMany({ where: { id: { in: influencerIds } }, select: { id: true, displayName: true, relationshipStatus: true, countryCode: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return influencerIds.map((id) => {
      const inf = byId.get(id);
      if (!inf || isCountryOutOfScope(countryScope, inf.countryCode)) return { influencerId: id, label: null, willApply: false, message: 'Influencer not found' };
      if (inf.relationshipStatus === status) return { influencerId: id, label: inf.displayName, willApply: false, message: `Already ${status.toLowerCase()}` };
      return { influencerId: id, label: inf.displayName, willApply: true, message: null };
    });
  }

  /** Read-only tag lookup for planning — a preview must never create data as
   *  a side effect (only execute()'s applyRow may). Returns null when no tag
   *  with this name exists yet, which planAddTag treats as "nobody has it". */
  async function findTagId(tagName: string): Promise<string | null> {
    const tag = await prisma.tag.findUnique({ where: { name: tagName }, select: { id: true } });
    return tag?.id ?? null;
  }

  /** Resolves the tag once (findOrCreate-by-name) for a REAL write — used only by execute()'s applyRow, never by planning. */
  async function resolveTagId(tagName: string): Promise<string> {
    const tag = await prisma.tag.upsert({ where: { name: tagName }, update: {}, create: { name: tagName } });
    return tag.id;
  }

  async function plan(input: BulkInfluencerRequest): Promise<PlannedRow[]> {
    // Country scope resolved once per call, shared by every row's check
    // below (Security & Authorization Freeze Gate — every row needs its own
    // scope check, e.g. an influencer's countryCode).
    const countryScope = await scopedCountryCodes(ctx);
    switch (input.action) {
      case 'ASSIGN_OWNER':
        return planAssignOwner(input.influencerIds, input.ownerId, countryScope);
      case 'ADD_TAG':
        // findTagId (read-only) — NOT resolveTagId (upsert) — planning must
        // stay side-effect-free even when called from preview(); execute()'s
        // applyRow does the real find-or-create write.
        return planAddTag(input.influencerIds, await findTagId(input.tagName), countryScope);
      case 'SET_RELATIONSHIP_STATUS':
        return planSetRelationshipStatus(input.influencerIds, input.status, countryScope);
    }
  }

  /**
   * True read-only dry run — requires only authentication (execute() alone
   * carries the ADMIN gate), but must never write and must never reveal more
   * about an out-of-scope creator than a capability-less/out-of-scope caller
   * should see (Security & Authorization Freeze Gate). `plan()` now (a)
   * resolves ADD_TAG's tag with a plain lookup rather than the
   * find-or-create upsert execute() uses, so naming a brand-new tag in a
   * preview alone can no longer create it as a side effect, and (b) masks
   * any row whose influencer is outside the actor's own country scope
   * identically to a truly-missing one, so preview can never leak an
   * out-of-scope creator's display name / owner / tags / relationship status.
   */
  async function preview(input: BulkInfluencerRequest): Promise<BulkPreviewDTO> {
    requireActor(ctx);
    const rows = await plan(input);
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

  async function applyRow(input: BulkInfluencerRequest, row: PlannedRow): Promise<void> {
    switch (input.action) {
      case 'ASSIGN_OWNER':
        await prisma.influencer.update({ where: { id: row.influencerId }, data: { ownerId: input.ownerId } });
        return;
      case 'ADD_TAG': {
        const tagId = await resolveTagId(input.tagName);
        await prisma.influencerTag.create({ data: { influencerId: row.influencerId, tagId } });
        return;
      }
      case 'SET_RELATIONSHIP_STATUS':
        await prisma.influencer.update({ where: { id: row.influencerId }, data: { relationshipStatus: input.status } });
        return;
    }
  }

  async function execute(input: BulkInfluencerRequest): Promise<BulkResultDTO> {
    // Bulk edits touch many creators' records at once, unlike a single-item
    // edit — reserve that blast radius for admins (same posture as the other
    // directory-wide write, W1-4's least-privilege groundwork).
    const actor = requireAdmin(ctx);
    const rows = await plan(input);

    const results: BulkRowResultDTO[] = [];
    for (const row of rows) {
      if (!row.willApply) {
        results.push({ influencerId: row.influencerId, label: row.label, status: 'skipped', id: null, message: row.message });
        continue;
      }
      try {
        await applyRow(input, row);
        results.push({ influencerId: row.influencerId, label: row.label, status: 'added', id: row.influencerId, message: null });
      } catch (err) {
        results.push({
          influencerId: row.influencerId,
          label: row.label,
          status: 'failed',
          id: null,
          message: err instanceof AppError ? err.message : 'Something went wrong',
        });
      }
    }

    const added = results.filter((r) => r.status === 'added').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    if (added > 0) {
      await logActivity(ctx, {
        type: 'GENERIC',
        message: `${actor.name} applied a bulk ${input.action.toLowerCase().replace(/_/g, ' ')} to ${added} creator${added === 1 ? '' : 's'}.`,
        meta: { action: input.action, added, skipped, failed },
      });
    }

    return { added, skipped, failed, results };
  }

  return { preview, execute };
}

export type BulkInfluencerService = ReturnType<typeof makeBulkInfluencerService>;
