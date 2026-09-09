import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/activity',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Activity'],
        summary: 'Chronological activity feed, optionally scoped to a brand, campaign or influencer',
        querystring: requests.activityFilterSchema,
      },
    },
    async (req) => servicesFor(req).activity.feed(req.query),
  );
}
