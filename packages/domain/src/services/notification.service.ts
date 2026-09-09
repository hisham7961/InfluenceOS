import { requests, type CursorPage, type NotificationDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { toNotificationDTO } from '../lib/mappers';

type NotificationFilter = z.infer<typeof requests.notificationFilterSchema>;
type MarkReadInput = z.infer<typeof requests.markReadSchema>;

/**
 * In-app notifications for the current actor (spec §22). A notification with
 * a null userId is a broadcast — visible to every actor — so scoping always
 * matches `userId = actor.id OR userId IS NULL`.
 */
export function makeNotificationService(ctx: DomainContext) {
  const { prisma } = ctx;

  function actorScope(actorId: string): Prisma.NotificationWhereInput {
    return { OR: [{ userId: actorId }, { userId: null }] };
  }

  async function list(filter: NotificationFilter): Promise<CursorPage<NotificationDTO>> {
    const actor = requireActor(ctx);
    const where: Prisma.NotificationWhereInput = {
      AND: [actorScope(actor.id), ...(filter.unreadOnly ? [{ isRead: false }] : [])],
    };

    const rows = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      data: page.map(toNotificationDTO),
      nextCursor,
      hasMore,
    };
  }

  async function unreadCount(): Promise<number> {
    const actor = requireActor(ctx);
    return prisma.notification.count({
      where: { AND: [actorScope(actor.id), { isRead: false }] },
    });
  }

  async function markRead(input: MarkReadInput): Promise<{ updated: number }> {
    const actor = requireActor(ctx);

    if (input.all) {
      const result = await prisma.notification.updateMany({
        where: { AND: [actorScope(actor.id), { isRead: false }] },
        data: { isRead: true, readAt: new Date() },
      });
      return { updated: result.count };
    }

    if (!input.ids || input.ids.length === 0) {
      throw AppError.badRequest('Provide notification ids or set all to true.');
    }

    const result = await prisma.notification.updateMany({
      where: { AND: [actorScope(actor.id), { id: { in: input.ids } }] },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  return { list, unreadCount, markRead };
}

export type NotificationService = ReturnType<typeof makeNotificationService>;
