import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
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

  r.get(
    '/notifications/settings',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'Your email settings: summary frequency, kinds emailed as they happen, and whether email is set up',
      },
    },
    async (req) => servicesFor(req).notifications.settings(),
  );

  r.patch(
    '/notifications/settings',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'Change your summary frequency and/or which notifications are emailed to you',
        body: requests.notificationSettingsSchema,
      },
    },
    async (req) => servicesFor(req).notifications.updateSettings(req.body),
  );

  r.get(
    '/notifications/digest-preview',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'What your summary email would contain right now (scoped to your brands and countries)',
      },
    },
    async (req) => servicesFor(req).notifications.digestPreview(),
  );

  r.post(
    '/notifications/test-email',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Notifications'],
        summary: 'Send yourself a test email (409 when email is not set up; at most one a minute)',
      },
    },
    async (req) => servicesFor(req).notifications.sendTestEmail(),
  );
}
