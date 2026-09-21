import { requests, type ConversationUnreadDTO, type MentionRefDTO, type NoteDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireOwnerOrAdmin } from '../lib/authz';
import { createNotification, iso, logActivity } from '../lib/helpers';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';

type NoteCreate = z.infer<typeof requests.noteCreateSchema>;

/** Minimal patch for an existing note — body and/or pinned state (PATCH /notes/:id, unchanged shape). */
export interface NoteUpdateInput {
  body?: string;
  pinned?: boolean;
}

const noteInclude = {
  author: { select: { id: true, name: true } },
  mentions: { include: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.NoteInclude;

type NoteRow = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

function toMentionRefs(row: NoteRow): MentionRefDTO[] {
  return row.mentions.map((m) => ({ userId: m.userId, name: m.user.name }));
}

function toNoteDTO(row: NoteRow, replies?: NoteDTO[]): NoteDTO {
  const deleted = row.deletedAt != null;
  return {
    id: row.id,
    body: deleted ? '[deleted]' : row.body,
    influencerId: row.influencerId,
    brandId: row.brandId,
    publishedContentId: row.publishedContentId,
    campaignId: row.campaignId,
    deliverableId: row.deliverableId,
    shipmentId: row.shipmentId,
    inspirationItemId: row.inspirationItemId,
    channel: row.channel,
    parentId: row.parentId,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    pinned: row.pinned,
    editedAt: iso(row.editedAt),
    deleted,
    mentions: deleted ? [] : toMentionRefs(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(replies ? { replies } : {}),
  };
}

/** What a resolved context implies for scope-checking and for a mention/reply notification's deep link. */
interface ResolvedContext {
  brandId: string | null;
  campaignId: string | null;
  link: string;
  /** Human label for the context, used in notification titles ("Mona mentioned you on a Content comment"). */
  label: string;
}

/** A context identifier — used both to create a message and to list/filter a thread. Not derived from the Zod-inferred `NoteCreate` type so `channel` stays a plain string (the create schema narrows it to a fixed literal set; Prisma's column is a free string). */
export interface NoteContext {
  influencerId?: string | null;
  brandId?: string | null;
  publishedContentId?: string | null;
  campaignId?: string | null;
  deliverableId?: string | null;
  shipmentId?: string | null;
  inspirationItemId?: string | null;
  channel?: string | null;
}

/**
 * The shared Collaboration Layer (Operations Intelligence pass) — what began
 * as a simple per-Influencer/Brand/Content "Note" is now the ONE
 * message/comment/chat primitive reused for contextual comments (Content,
 * Deliverable, Shipment, Campaign, Influencer, Trend), a pinned Manager
 * Callout on content, Campaign Chat, and General Team Chat. See the doc
 * comment on the Prisma `Note` model for the full rationale — never a second
 * comment/chat model, never a second notification/mention pipeline.
 */
export function makeNoteService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function resolveContext(input: NoteContext): Promise<ResolvedContext> {
    if (input.influencerId) {
      const inf = await prisma.influencer.findUnique({ where: { id: input.influencerId }, select: { id: true, displayName: true } });
      if (!inf) throw AppError.notFound('Influencer');
      return { brandId: null, campaignId: null, link: `/influencers/${inf.id}`, label: `${inf.displayName}'s profile` };
    }
    if (input.brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: input.brandId }, select: { id: true, slug: true, name: true } });
      if (!brand) throw AppError.notFound('Brand');
      return { brandId: brand.id, campaignId: null, link: `/brands/${brand.slug}`, label: brand.name };
    }
    if (input.publishedContentId) {
      const pc = await prisma.publishedContent.findUnique({
        where: { id: input.publishedContentId },
        select: { id: true, brandId: true },
      });
      if (!pc) throw AppError.notFound('Content');
      return { brandId: pc.brandId, campaignId: null, link: `/content/${pc.id}`, label: 'a video' };
    }
    if (input.campaignId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true, brandId: true, name: true } });
      if (!campaign) throw AppError.notFound('Campaign');
      return { brandId: campaign.brandId, campaignId: campaign.id, link: `/campaigns/${campaign.id}?tab=discussion`, label: campaign.name };
    }
    if (input.deliverableId) {
      const d = await prisma.deliverable.findUnique({
        where: { id: input.deliverableId },
        select: { id: true, campaignInfluencer: { select: { campaign: { select: { id: true, brandId: true, name: true } } } } },
      });
      if (!d) throw AppError.notFound('Deliverable');
      const c = d.campaignInfluencer.campaign;
      return { brandId: c.brandId, campaignId: c.id, link: `/campaigns/${c.id}?tab=deliverables`, label: `a deliverable on ${c.name}` };
    }
    if (input.shipmentId) {
      const s = await prisma.productShipment.findUnique({
        where: { id: input.shipmentId },
        select: { id: true, campaignInfluencer: { select: { campaign: { select: { id: true, brandId: true, name: true } } } } },
      });
      if (!s) throw AppError.notFound('Shipment');
      const c = s.campaignInfluencer.campaign;
      return { brandId: c.brandId, campaignId: c.id, link: `/campaigns/${c.id}?tab=shipments`, label: `a shipment on ${c.name}` };
    }
    if (input.inspirationItemId) {
      const item = await prisma.inspirationItem.findUnique({ where: { id: input.inspirationItemId }, select: { id: true, brandId: true, title: true } });
      if (!item) throw AppError.notFound('Inspiration item');
      return { brandId: item.brandId, campaignId: null, link: `/inspiration/${item.id}`, label: item.title ?? 'a trend' };
    }
    if (input.channel) {
      return { brandId: null, campaignId: null, link: '/team', label: 'General' };
    }
    throw AppError.badRequest('A message must be attached to a context or be a reply.');
  }

  /** Enforce brand scope for a resolved context — a brand-scoped user (W4-4) must never read/write outside their scope. */
  async function assertInScope(brandId: string | null): Promise<void> {
    if (!brandId) return;
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, brandId)) throw AppError.notFound('Context');
  }

  async function listForInfluencer(influencerId: string): Promise<NoteDTO[]> {
    const notes = await prisma.note.findMany({
      where: { influencerId, parentId: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: noteInclude,
    });
    return notes.map((n) => toNoteDTO(n));
  }

  /** Internal notes on a brand — reuses the same Note model (previously create()-only; no list route existed). */
  async function listForBrand(brandId: string): Promise<NoteDTO[]> {
    await assertInScope(brandId);
    const notes = await prisma.note.findMany({
      where: { brandId, parentId: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: noteInclude,
    });
    return notes.map((n) => toNoteDTO(n));
  }

  /** Internal notes / pinned Manager Callouts on a piece of content (Content Command Center + Operations Intelligence passes) — reuses this SAME Note model, never a parallel content-comment system. */
  async function listForContent(publishedContentId: string): Promise<NoteDTO[]> {
    const notes = await prisma.note.findMany({
      where: { publishedContentId, parentId: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: noteInclude,
    });
    return withReplies(notes);
  }

  /** One level of replies attached to each top-level row — two queries total, never N+1. */
  async function withReplies(topLevel: NoteRow[]): Promise<NoteDTO[]> {
    if (topLevel.length === 0) return [];
    const replyRows = await prisma.note.findMany({
      where: { parentId: { in: topLevel.map((n) => n.id) } },
      orderBy: [{ createdAt: 'asc' }],
      include: noteInclude,
    });
    const byParent = new Map<string, NoteDTO[]>();
    for (const r of replyRows) {
      const list = byParent.get(r.parentId!) ?? [];
      list.push(toNoteDTO(r));
      byParent.set(r.parentId!, list);
    }
    return topLevel.map((n) => toNoteDTO(n, byParent.get(n.id) ?? []));
  }

  /** Generic context list — Deliverable/Shipment/Inspiration comments and Campaign/General chat, each with one level of replies inlined. */
  async function list(context: NoteContext, query: { cursor?: string; limit?: number } = {}): Promise<{ data: NoteDTO[]; nextCursor: string | null; hasMore: boolean }> {
    const resolved = await resolveContext(context);
    await assertInScope(resolved.brandId);
    const limit = query.limit ?? 30;
    const where: Prisma.NoteWhereInput = {
      parentId: null,
      ...(context.campaignId ? { campaignId: context.campaignId } : {}),
      ...(context.deliverableId ? { deliverableId: context.deliverableId } : {}),
      ...(context.shipmentId ? { shipmentId: context.shipmentId } : {}),
      ...(context.inspirationItemId ? { inspirationItemId: context.inspirationItemId } : {}),
      ...(context.channel ? { channel: context.channel } : {}),
    };
    const rows = await prisma.note.findMany({
      where,
      include: noteInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data = await withReplies(page);
    return { data, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null, hasMore };
  }

  async function create(input: NoteCreate): Promise<NoteDTO> {
    const actor = requireActor(ctx);

    let parent: NoteRow | null = null;
    if (input.parentId) {
      parent = await prisma.note.findUnique({ where: { id: input.parentId }, include: noteInclude });
      if (!parent) throw AppError.notFound('Message');
      if (parent.parentId) throw AppError.badRequest('Replies are one level deep — reply to the top-level message instead.');
    }

    // A reply inherits its parent's context (never carries its own).
    const context: NoteContext = parent
      ? {
          influencerId: parent.influencerId ?? undefined,
          brandId: parent.brandId ?? undefined,
          publishedContentId: parent.publishedContentId ?? undefined,
          campaignId: parent.campaignId ?? undefined,
          deliverableId: parent.deliverableId ?? undefined,
          shipmentId: parent.shipmentId ?? undefined,
          inspirationItemId: parent.inspirationItemId ?? undefined,
          channel: parent.channel ?? undefined,
        }
      : input;

    const resolved = await resolveContext(context);
    await assertInScope(resolved.brandId);

    // Pinning at creation time follows the same authorization rule as the
    // dedicated pin() endpoint (PART 8) — never silently accepted from any actor.
    const canPin = input.pinned ? await actorCanPin(resolved) : true;
    if (input.pinned && !canPin) throw AppError.forbidden('Only an admin, the campaign owner, or the author may pin a message.');

    const mentionIds = Array.from(new Set((input.mentionedUserIds ?? []).filter((id) => id !== actor.id)));
    const validMentionIds = mentionIds.length
      ? (await prisma.user.findMany({ where: { id: { in: mentionIds }, isActive: true }, select: { id: true } })).map((u) => u.id)
      : [];

    const note = await prisma.note.create({
      data: {
        body: input.body,
        influencerId: context.influencerId ?? null,
        brandId: context.brandId ?? null,
        publishedContentId: context.publishedContentId ?? null,
        campaignId: context.campaignId ?? null,
        deliverableId: context.deliverableId ?? null,
        shipmentId: context.shipmentId ?? null,
        inspirationItemId: context.inspirationItemId ?? null,
        channel: context.channel ?? null,
        parentId: input.parentId ?? null,
        authorId: actor.id,
        pinned: input.pinned ?? false,
        mentions: validMentionIds.length ? { create: validMentionIds.map((userId) => ({ userId })) } : undefined,
      },
      include: noteInclude,
    });

    // Personal triage-style notes (plain Influencer/Brand/Content notes with
    // no reply/mention/chat activity) stay logged to ActivityLog exactly as
    // before; chat/comment traffic does NOT get logged there (PART 40 —
    // Activity is system-generated fact, Chat is human discussion).
    if (!parent && !context.channel && !context.deliverableId && !context.shipmentId && !context.inspirationItemId) {
      await logActivity(ctx, {
        type: 'NOTE_ADDED',
        message: `${actor.name} added a note.`,
        influencerId: note.influencerId,
        brandId: note.brandId,
        publishedContentId: note.publishedContentId,
        campaignId: note.campaignId,
      });
    }

    await notifyMentionsAndReply(note, resolved, parent);

    return toNoteDTO(note);
  }

  /** Mentions always notify; a reply also notifies the parent's author (once, deduped against mentions and self). */
  async function notifyMentionsAndReply(note: NoteRow, resolved: ResolvedContext, parent: NoteRow | null): Promise<void> {
    const actor = requireActor(ctx);
    const notified = new Set<string>([actor.id]);
    for (const m of note.mentions) {
      if (notified.has(m.userId)) continue;
      notified.add(m.userId);
      await createNotification(ctx, {
        category: 'MENTION',
        title: `${actor.name} mentioned you`,
        body: note.pinned ? `Pinned on ${resolved.label}` : resolved.label,
        targetUrl: resolved.link,
        userId: m.userId,
        brandId: resolved.brandId,
        campaignId: resolved.campaignId,
        publishedContentId: note.publishedContentId,
        influencerId: note.influencerId,
      });
    }
    if (parent?.authorId && !notified.has(parent.authorId)) {
      notified.add(parent.authorId);
      await createNotification(ctx, {
        category: 'REPLY',
        title: `${actor.name} replied to you`,
        body: resolved.label,
        targetUrl: resolved.link,
        userId: parent.authorId,
        brandId: resolved.brandId,
        campaignId: resolved.campaignId,
        publishedContentId: note.publishedContentId,
        influencerId: note.influencerId,
      });
    }
    // A pinned top-level message on CONTENT is an announcement-style Manager
    // Callout — see pin() below, which sends its own IMPORTANT_MESSAGE
    // notification when a content note transitions to pinned. Deliberately
    // scoped to content only: a Campaign/General chat pin would otherwise
    // notify every brand-scoped user on every pinned chat message.
  }

  /** PART 8's pin authorization: ADMIN always; the campaign's own owner within their campaign; otherwise only the note's own author. */
  async function actorCanPin(resolved: ResolvedContext, authorId?: string | null): Promise<boolean> {
    const actor = requireActor(ctx);
    if (actor.role === 'ADMIN') return true;
    if (resolved.campaignId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: resolved.campaignId }, select: { ownerId: true } });
      if (campaign?.ownerId === actor.id) return true;
    }
    return authorId != null && authorId === actor.id;
  }

  async function pin(id: string, pinned: boolean): Promise<NoteDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.note.findUnique({ where: { id }, include: noteInclude });
    if (!existing) throw AppError.notFound('Note');
    const context: NoteContext = {
      influencerId: existing.influencerId ?? undefined,
      brandId: existing.brandId ?? undefined,
      publishedContentId: existing.publishedContentId ?? undefined,
      campaignId: existing.campaignId ?? undefined,
      deliverableId: existing.deliverableId ?? undefined,
      shipmentId: existing.shipmentId ?? undefined,
      inspirationItemId: existing.inspirationItemId ?? undefined,
      channel: existing.channel ?? undefined,
    };
    const resolved = await resolveContext(context);
    await assertInScope(resolved.brandId);
    if (!(await actorCanPin(resolved, existing.authorId))) {
      throw AppError.forbidden('Only an admin, the campaign owner, or the author may pin a message.');
    }
    const note = await prisma.note.update({ where: { id }, data: { pinned }, include: noteInclude });
    if (pinned && !existing.pinned && note.publishedContentId) {
      // A newly-pinned Manager Callout on content is worth surfacing beyond
      // the author's own mentions — but only for content (the one place
      // PART 6-7 explicitly asks for a prominent pinned callout), never for
      // chat, to avoid notifying an entire brand on every pinned chat message.
      await createNotification(ctx, {
        category: 'IMPORTANT_MESSAGE',
        title: `${actor.name} pinned an important note`,
        body: note.body.slice(0, 140),
        targetUrl: resolved.link,
        publishedContentId: note.publishedContentId,
        brandId: resolved.brandId,
      });
    }
    return toNoteDTO(note);
  }

  async function editBody(id: string, body: string): Promise<NoteDTO> {
    requireActor(ctx);
    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Note');
    requireOwnerOrAdmin(ctx, existing.authorId, 'message');
    const note = await prisma.note.update({ where: { id }, data: { body, editedAt: new Date() }, include: noteInclude });
    return toNoteDTO(note);
  }

  /** Backward-compatible PATCH /notes/:id — routes body edits and pin/unpin through their own gated paths. */
  async function update(id: string, input: NoteUpdateInput): Promise<NoteDTO> {
    let result: NoteDTO | null = null;
    if (input.body !== undefined) result = await editBody(id, input.body);
    if (input.pinned !== undefined) result = await pin(id, input.pinned);
    if (!result) throw AppError.badRequest('Nothing to update.');
    return result;
  }

  async function remove(id: string): Promise<void> {
    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Note');
    // Least privilege (SEC-04): only the author or an ADMIN may delete a note.
    requireOwnerOrAdmin(ctx, existing.authorId, 'note');
    const replyCount = await prisma.note.count({ where: { parentId: id } });
    if (replyCount > 0) {
      // Soft delete — a hard delete here would cascade-orphan live replies
      // (PART 87: "consider soft delete rather than physical deletion").
      await prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
    } else {
      await prisma.note.delete({ where: { id } });
    }
  }

  async function listMentionsForUser(query: { cursor?: string; limit?: number; unreadOnly?: boolean }): Promise<{ data: NoteDTO[]; nextCursor: string | null; hasMore: boolean }> {
    const actor = requireActor(ctx);
    const limit = query.limit ?? 20;
    const rows = await prisma.noteMention.findMany({
      where: { userId: actor.id },
      include: { note: { include: noteInclude } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      data: page.map((r) => toNoteDTO(r.note)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async function markConversationRead(conversationKey: string): Promise<string> {
    const actor = requireActor(ctx);
    const now = new Date();
    await prisma.conversationReadState.upsert({
      where: { userId_conversationKey: { userId: actor.id, conversationKey } },
      create: { userId: actor.id, conversationKey, lastReadAt: now },
      update: { lastReadAt: now },
    });
    return now.toISOString();
  }

  /** Parses a `conversationKey` exactly as `<CommentThread>` builds it — 'channel:general' or 'campaign:{id}' — into the Note filter that scopes it. Unknown/malformed keys resolve to `null` and are skipped, never thrown. */
  function conversationWhere(key: string): Prisma.NoteWhereInput | null {
    if (key === 'channel:general') return { channel: 'general' };
    const campaignMatch = /^campaign:(.+)$/.exec(key);
    if (campaignMatch) return { campaignId: campaignMatch[1] };
    return null;
  }

  /** Unread counts for a set of conversations (Campaign Chat / General only — PART 16), each identified by the same `conversationKey` string `<CommentThread>` already uses to mark itself read — one query per key, never one row-per-message. */
  async function unreadCounts(conversationKeys: string[]): Promise<ConversationUnreadDTO[]> {
    const actor = requireActor(ctx);
    const keyed = conversationKeys.map((key) => ({ key, where: conversationWhere(key) })).filter((k): k is { key: string; where: Prisma.NoteWhereInput } => k.where != null);
    const reads = await prisma.conversationReadState.findMany({
      where: { userId: actor.id, conversationKey: { in: keyed.map((c) => c.key) } },
    });
    const lastReadByKey = new Map(reads.map((r) => [r.conversationKey, r.lastReadAt]));
    const out: ConversationUnreadDTO[] = [];
    for (const { key, where } of keyed) {
      const since = lastReadByKey.get(key) ?? null;
      const unreadCount = await prisma.note.count({
        where: { ...where, authorId: { not: actor.id }, ...(since ? { createdAt: { gt: since } } : {}) },
      });
      out.push({ conversationKey: key, unreadCount, lastReadAt: since ? since.toISOString() : null });
    }
    return out;
  }

  return {
    listForInfluencer,
    listForBrand,
    listForContent,
    list,
    create,
    update,
    editBody,
    pin,
    remove,
    listMentionsForUser,
    markConversationRead,
    unreadCounts,
  };
}

export type NoteService = ReturnType<typeof makeNoteService>;
