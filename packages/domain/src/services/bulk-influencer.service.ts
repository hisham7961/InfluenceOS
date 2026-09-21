import { requests, type BulkPreviewDTO, type BulkResultDTO, type BulkRowResultDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireAdmin } from '../lib/authz';
import { logActivity } from '../lib/helpers';

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

  async function planAssignOwner(influencerIds: string[], ownerId: string): Promise<PlannedRow[]> {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, isActive: true } });
    if (!owner || !owner.isActive) throw AppError.badRequest('That owner account does not exist or is inactive.');

    const rows = await prisma.influencer.findMany({ where: { id: { in: influencerIds } }, select: { id: true, displayName: true, ownerId: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return influencerIds.map((id) => {
      const inf = byId.get(id);
      if (!inf) return { influencerId: id, label: null, willApply: false, message: 'Influencer not found' };
      if (inf.ownerId === ownerId) return { influencerId: id, label: inf.displayName, willApply: false, message: 'Already assigned to this owner' };
      return { influencerId: id, label: inf.displayName, willApply: true, message: null };
    });
  }

  async function planAddTag(influencerIds: string[], tagId: string): Promise<PlannedRow[]> {
    const rows = await prisma.influencer.findMany({
      where: { id: { in: influencerIds } },
      select: { id: true, displayName: true, tags: { where: { tagId }, select: { id: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return influencerIds.map((id) => {
      const inf = byId.get(id);
      if (!inf) return { influencerId: id, label: null, willApply: false, message: 'Influencer not found' };
      if (inf.tags.length > 0) return { influencerId: id, label: inf.displayName, willApply: false, message: 'Already tagged' };
      return { influencerId: id, label: inf.displayName, willApply: true, message: null };
    });
  }

  async function planSetRelationshipStatus(influencerIds: string[], status: string): Promise<PlannedRow[]> {
    const rows = await prisma.influencer.findMany({ where: { id: { in: influencerIds } }, select: { id: true, displayName: true, relationshipStatus: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return influencerIds.map((id) => {
      const inf = byId.get(id);
      if (!inf) return { influencerId: id, label: null, willApply: false, message: 'Influencer not found' };
      if (inf.relationshipStatus === status) return { influencerId: id, label: inf.displayName, willApply: false, message: `Already ${status.toLowerCase()}` };
      return { influencerId: id, label: inf.displayName, willApply: true, message: null };
    });
  }

  /** Resolves the tag once (findOrCreate-by-name), shared by preview and execute so both see the same tagId. */
  async function resolveTagId(tagName: string): Promise<string> {
    const tag = await prisma.tag.upsert({ where: { name: tagName }, update: {}, create: { name: tagName } });
    return tag.id;
  }

  async function plan(input: BulkInfluencerRequest): Promise<PlannedRow[]> {
    switch (input.action) {
      case 'ASSIGN_OWNER':
        return planAssignOwner(input.influencerIds, input.ownerId);
      case 'ADD_TAG':
        return planAddTag(input.influencerIds, await resolveTagId(input.tagName));
      case 'SET_RELATIONSHIP_STATUS':
        return planSetRelationshipStatus(input.influencerIds, input.status);
    }
  }

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
