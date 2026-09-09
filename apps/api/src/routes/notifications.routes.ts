import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/notifications',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'List notifications for the current actor (cursor-paginated)',
        querystring: requests.notificationFilterSchema,
      },
    },
    async (req) => servicesFor(req).notifications.list(req.query),
  );

  r.get(
    '/notifications/unread-count',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'Unread notification count for the current actor',
      },
    },
    async (req) => {
      const count = await servicesFor(req).notifications.unreadCount();
      return { count };
    },
  );

  r.post(
    '/notifications/read',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'Mark notifications as read (by ids, or all)',
        body: requests.markReadSchema,
      },
    },
    async (req) => servicesFor(req).notifications.markRead(req.body),
  );
}
