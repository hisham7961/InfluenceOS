import { requests, type NoteDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';

type NoteCreate = z.infer<typeof requests.noteCreateSchema>;

/** Minimal patch for an existing note — body and/or pinned state. */
export interface NoteUpdateInput {
  body?: string;
  pinned?: boolean;
}

const noteInclude = {
  author: { select: { name: true } },
} as const;

interface NoteLike {
  id: string;
  body: string;
  influencerId: string | null;
  brandId: string | null;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: { name: string } | null;
}

function toNoteDTO(n: NoteLike): NoteDTO {
  return {
    id: n.id,
    body: n.body,
    influencerId: n.influencerId,
    brandId: n.brandId,
    authorName: n.author?.name ?? null,
    pinned: n.pinned,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/**
 * Internal notes (spec §31) attachable to an influencer or a brand — pinned
 * ones surface first so the team's most important context stays on top.
 */
export function makeNoteService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function listForInfluencer(influencerId: string): Promise<NoteDTO[]> {
    const notes = await prisma.note.findMany({
      where: { influencerId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: noteInclude,
    });
    return notes.map(toNoteDTO);
  }

  async function create(input: NoteCreate): Promise<NoteDTO> {
    const actor = requireActor(ctx);
    if (!input.influencerId && !input.brandId) {
      throw AppError.badRequest('A note must be attached to an influencer or a brand.');
    }

    const note = await prisma.note.create({
      data: {
        body: input.body,
        influencerId: input.influencerId ?? null,
        brandId: input.brandId ?? null,
        authorId: actor.id,
        pinned: input.pinned ?? false,
      },
      include: noteInclude,
    });

    await logActivity(ctx, {
      type: 'NOTE_ADDED',
      message: `${actor.name} added a note.`,
      influencerId: note.influencerId,
      brandId: note.brandId,
    });

    return toNoteDTO(note);
  }

  async function update(id: string, input: NoteUpdateInput): Promise<NoteDTO> {
    requireActor(ctx);
    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Note');

    const note = await prisma.note.update({
      where: { id },
      data: {
        body: input.body ?? undefined,
        pinned: input.pinned ?? undefined,
      },
      include: noteInclude,
    });

    return toNoteDTO(note);
  }

  async function remove(id: string): Promise<void> {
    requireActor(ctx);
    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Note');
    await prisma.note.delete({ where: { id } });
  }

  return { listForInfluencer, create, update, remove };
}

export type NoteService = ReturnType<typeof makeNoteService>;
