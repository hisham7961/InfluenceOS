import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

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

  r.get(
    '/search/page',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Search'],
        summary: 'Full ranked, paginated search page (indexes notes + tags) (W3-6)',
        querystring: requests.searchPageSchema,
      },
    },
    async (req) => servicesFor(req).search.searchPage(req.query),
  );

  // --- Saved views / segments (W3-6) ----------------------------------------
  r.get(
    '/saved-views',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Search'], summary: 'List saved views (own + shared)', querystring: requests.savedViewFilterSchema },
    },
    async (req) => servicesFor(req).savedViews.list(req.query.scope),
  );

  r.post(
    '/saved-views',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Search'], summary: 'Create a saved view', body: requests.savedViewCreateSchema },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).savedViews.create(req.body);
    },
  );

  r.get(
    '/saved-views/:id',
    { preHandler: [requireAuth], schema: { tags: ['Search'], summary: 'Get a saved view', params: idParam } },
    async (req) => servicesFor(req).savedViews.get(req.params.id),
  );

  r.patch(
    '/saved-views/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Search'], summary: 'Update a saved view (owner or admin)', params: idParam, body: requests.savedViewUpdateSchema },
    },
    async (req) => servicesFor(req).savedViews.update(req.params.id, req.body),
  );

  r.delete(
    '/saved-views/:id',
    { preHandler: [requireAuth], schema: { tags: ['Search'], summary: 'Delete a saved view (owner or admin)', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).savedViews.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
