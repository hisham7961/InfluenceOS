import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function socialAccountRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.patch(
    '/social-accounts/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Update a social account',
        params: idParam,
        body: requests.socialAccountUpdateSchema,
      },
    },
    async (req) => servicesFor(req).socialAccounts.update(req.params.id, req.body),
  );

  r.post(
    '/social-accounts/:id/sync',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Sync a social account via the platform adapter',
        params: idParam,
      },
    },
    async (req) => servicesFor(req).socialAccounts.sync(req.params.id),
  );

  r.delete(
    '/social-accounts/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Remove a social account',
        params: idParam,
      },
    },
    async (req, reply) => {
      await servicesFor(req).socialAccounts.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
