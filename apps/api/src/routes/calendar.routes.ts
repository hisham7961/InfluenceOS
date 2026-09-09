import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/calendar',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Calendar'],
        summary: 'Unified calendar feed (campaign dates, deliverables, expected publishes, published content)',
        querystring: requests.calendarQuerySchema,
      },
    },
    async (req) => servicesFor(req).calendar.events(req.query),
  );
}
