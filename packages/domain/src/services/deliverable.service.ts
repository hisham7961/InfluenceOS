import { requests, type DeliverableDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';

type DeliverableCreate = z.infer<typeof requests.deliverableCreateSchema>;
type DeliverableUpdate = z.infer<typeof requests.deliverableUpdateSchema>;

interface DeliverableRow {
  id: string;
  platform: DeliverableDTO['platform'];
  type: DeliverableDTO['type'];
  quantity: number;
  dueDate: Date | null;
  status: DeliverableDTO['status'];
  requirements: string | null;
  requiredHashtags: string[];
  requiredMentions: string[];
  scriptReferenceId: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  internalNotes: string | null;
}

export function toDeliverableDTO(d: DeliverableRow, publishedContentCount = 0): DeliverableDTO {
  return {
    id: d.id,
    platform: d.platform,
    type: d.type,
    quantity: d.quantity,
    dueDate: iso(d.dueDate),
    status: d.status,
    requirements: d.requirements,
    requiredHashtags: d.requiredHashtags,
    requiredMentions: d.requiredMentions,
    scriptReferenceId: d.scriptReferenceId,
    publishedUrl: d.publishedUrl,
    publishedAt: iso(d.publishedAt),
    internalNotes: d.internalNotes,
    publishedContentCount,
  };
}

export function makeDeliverableService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function campaignIdFor(campaignInfluencerId: string): Promise<{ campaignId: string; influencerId: string }> {
    const ci = await prisma.campaignInfluencer.findUnique({
      where: { id: campaignInfluencerId },
      select: { campaignId: true, influencerId: true },
    });
    if (!ci) throw AppError.notFound('Campaign influencer');
    return ci;
  }

  async function create(input: DeliverableCreate): Promise<DeliverableDTO> {
    requireActor(ctx);
    const ci = await campaignIdFor(input.campaignInfluencerId);
    const d = await prisma.deliverable.create({
      data: {
        campaignInfluencerId: input.campaignInfluencerId,
        platform: input.platform,
        type: input.type,
        quantity: input.quantity ?? 1,
        dueDate: input.dueDate ?? null,
        requirements: input.requirements ?? null,
        requiredHashtags: input.requiredHashtags ?? [],
        requiredMentions: input.requiredMentions ?? [],
        scriptReferenceId: input.scriptReferenceId ?? null,
        status: input.status ?? 'PLANNED',
        publishedUrl: input.publishedUrl ?? null,
        publishedAt: input.publishedAt ?? null,
        internalNotes: input.internalNotes ?? null,
      },
    });
    await logActivity(ctx, {
      type: 'DELIVERABLE_ADDED',
      message: `${ctx.actor?.name ?? 'Someone'} added a ${input.type.toLowerCase()} deliverable.`,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      deliverableId: d.id,
    });
    return toDeliverableDTO(d);
  }

  async function update(id: string, input: DeliverableUpdate): Promise<DeliverableDTO> {
    requireActor(ctx);
    const existing = await prisma.deliverable.findUnique({
      where: { id },
      include: { campaignInfluencer: { select: { campaignId: true, influencerId: true } } },
    });
    if (!existing) throw AppError.notFound('Deliverable');

    const d = await prisma.deliverable.update({
      where: { id },
      data: {
        platform: input.platform ?? undefined,
        type: input.type ?? undefined,
        quantity: input.quantity ?? undefined,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate,
        requirements: input.requirements === undefined ? undefined : input.requirements,
        requiredHashtags: input.requiredHashtags ?? undefined,
        requiredMentions: input.requiredMentions ?? undefined,
        scriptReferenceId: input.scriptReferenceId === undefined ? undefined : input.scriptReferenceId,
        status: input.status ?? undefined,
        publishedUrl: input.publishedUrl === undefined ? undefined : input.publishedUrl,
        publishedAt: input.publishedAt === undefined ? undefined : input.publishedAt,
        internalNotes: input.internalNotes === undefined ? undefined : input.internalNotes,
      },
    });

    if (input.status && input.status !== existing.status) {
      await logActivity(ctx, {
        type: 'DELIVERABLE_STATUS_CHANGED',
        message: `${ctx.actor?.name ?? 'Someone'} marked a ${existing.type.toLowerCase()} deliverable as ${input.status.replace(/_/g, ' ').toLowerCase()}.`,
        campaignId: existing.campaignInfluencer.campaignId,
        influencerId: existing.campaignInfluencer.influencerId,
        deliverableId: id,
        meta: { from: existing.status, to: input.status },
      });
    }
    return toDeliverableDTO(d);
  }

  async function remove(id: string): Promise<void> {
    requireActor(ctx);
    const existing = await prisma.deliverable.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Deliverable');
    await prisma.deliverable.delete({ where: { id } });
  }

  return { create, update, remove };
}

export type DeliverableService = ReturnType<typeof makeDeliverableService>;
