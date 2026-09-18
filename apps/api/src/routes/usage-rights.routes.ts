import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Usage-rights (content-licensing) ledger + license-expiry alerts (W3-2).
 * Rights are recorded under a brand; each carries a derived effectiveStatus so
 * the client never plans ad spend on rights that have lapsed or are about to.
 */
export async function usageRightRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/brands/:id/usage-rights',
    { preHandler: [requireAuth], schema: { tags: ['Brands'], summary: 'List usage rights for a brand', params: idParam } },
    async (req) => servicesFor(req).usageRights.listForBrand(req.params.id),
  );

  r.post(
    '/brands/:id/usage-rights',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Brands'],
        summary: 'Record a usage right for a brand',
        params: idParam,
        body: requests.usageRightCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).usageRights.create(req.params.id, req.body);
    },
  );

  r.get(
    '/usage-rights/:id',
    { preHandler: [requireAuth], schema: { tags: ['Brands'], summary: 'Get a usage right', params: idParam } },
    async (req) => servicesFor(req).usageRights.get(req.params.id),
  );

  r.patch(
    '/usage-rights/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Brands'],
        summary: 'Update a usage right',
        params: idParam,
        body: requests.usageRightUpdateSchema,
      },
    },
    async (req) => servicesFor(req).usageRights.update(req.params.id, req.body),
  );

  r.post(
    '/usage-rights/:id/revoke',
    { preHandler: [requireAuth], schema: { tags: ['Brands'], summary: 'Revoke a usage right', params: idParam } },
    async (req) => servicesFor(req).usageRights.revoke(req.params.id),
  );
}
