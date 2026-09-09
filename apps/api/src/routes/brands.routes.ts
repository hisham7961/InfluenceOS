import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAdmin, requireAuth, servicesFor } from '../http';

export async function brandRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/brands',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Brands'],
        summary: 'List brands (for the brand switcher and management)',
        querystring: z.object({ includeInactive: z.coerce.boolean().optional() }),
      },
    },
    async (req) => servicesFor(req).brands.list({ includeInactive: req.query.includeInactive }),
  );

  r.post(
    '/brands',
    { preHandler: [requireAdmin], schema: { tags: ['Brands'], summary: 'Create a brand (admin)', body: requests.brandCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).brands.create(req.body);
    },
  );

  r.get(
    '/brands/:idOrSlug',
    { preHandler: [requireAuth], schema: { tags: ['Brands'], summary: 'Get a brand by id or slug', params: z.object({ idOrSlug: z.string() }) } },
    async (req) => servicesFor(req).brands.detail(req.params.idOrSlug),
  );

  r.patch(
    '/brands/:id',
    { preHandler: [requireAdmin], schema: { tags: ['Brands'], summary: 'Update a brand (admin)', params: z.object({ id: z.string() }), body: requests.brandUpdateSchema } },
    async (req) => servicesFor(req).brands.update(req.params.id, req.body),
  );

  r.get(
    '/brands/:idOrSlug/dashboard',
    { preHandler: [requireAuth], schema: { tags: ['Dashboard'], summary: 'Brand workspace Mission Control', params: z.object({ idOrSlug: z.string() }) } },
    async (req) => servicesFor(req).dashboard.brand(req.params.idOrSlug),
  );
}
