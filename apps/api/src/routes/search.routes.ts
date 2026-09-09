import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/search',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Search'],
        summary: 'Global search across influencers, campaigns, brands, and content',
        querystring: requests.searchSchema,
      },
    },
    async (req) => servicesFor(req).search.search(req.query),
  );
}
