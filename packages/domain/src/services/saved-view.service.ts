import { requests, type SavedViewDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireOwnerOrAdmin } from '../lib/authz';

type SavedViewCreate = z.infer<typeof requests.savedViewCreateSchema>;
type SavedViewUpdate = z.infer<typeof requests.savedViewUpdateSchema>;

type Row = Prisma.SavedViewGetPayload<Record<string, never>>;

function toDTO(v: Row, actorId: string | null): SavedViewDTO {
  return {
    id: v.id,
    scope: v.scope,
    name: v.name,
    filters: v.filters,
    isShared: v.isShared,
    isOwn: v.userId != null && v.userId === actorId,
    ownerId: v.userId,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/**
 * Saved views / segments (W3-6): named, optionally shared filter sets per list
 * scope, so a useful filter persists and can be shared with the team. A caller
 * sees their own views plus everyone's shared views; only the owner (or an
 * admin) can edit or delete one.
 */
export function makeSavedViewService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function list(scope?: string): Promise<SavedViewDTO[]> {
    const actor = requireActor(ctx);
    const rows = await prisma.savedView.findMany({
      where: {
        ...(scope ? { scope } : {}),
        OR: [{ userId: actor.id }, { isShared: true }],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((r) => toDTO(r, actor.id));
  }

  async function get(id: string): Promise<SavedViewDTO> {
    const actor = requireActor(ctx);
    const v = await prisma.savedView.findUnique({ where: { id } });
    if (!v) throw AppError.notFound('Saved view');
    // A private view belongs only to its owner (or an admin).
    if (!v.isShared && v.userId !== actor.id && actor.role !== 'ADMIN') {
      throw AppError.notFound('Saved view');
    }
    return toDTO(v, actor.id);
  }

  async function create(input: SavedViewCreate): Promise<SavedViewDTO> {
    const actor = requireActor(ctx);
    const v = await prisma.savedView.create({
      data: {
        userId: actor.id,
        scope: input.scope,
        name: input.name,
        filters: (input.filters ?? {}) as Prisma.InputJsonValue,
        isShared: input.isShared ?? false,
      },
    });
    return toDTO(v, actor.id);
  }

  async function update(id: string, input: SavedViewUpdate): Promise<SavedViewDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.savedView.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) throw AppError.notFound('Saved view');
    requireOwnerOrAdmin(ctx, existing.userId, 'saved view');
    const v = await prisma.savedView.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        filters: input.filters === undefined ? undefined : (input.filters as Prisma.InputJsonValue),
        isShared: input.isShared ?? undefined,
      },
    });
    return toDTO(v, actor.id);
  }

  async function remove(id: string): Promise<void> {
    const existing = await prisma.savedView.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) throw AppError.notFound('Saved view');
    requireOwnerOrAdmin(ctx, existing.userId, 'saved view');
    await prisma.savedView.delete({ where: { id } });
  }

  return { list, get, create, update, remove };
}

export type SavedViewService = ReturnType<typeof makeSavedViewService>;
