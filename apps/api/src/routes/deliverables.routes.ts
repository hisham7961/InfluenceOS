import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function deliverableRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.patch(
    '/deliverables/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Update a deliverable',
        params: idParam,
        body: requests.deliverableUpdateSchema,
      },
    },
    async (req) => servicesFor(req).deliverables.update(req.params.id, req.body),
  );

  r.delete(
    '/deliverables/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Remove a deliverable',
        params: idParam,
      },
    },
    async (req, reply) => {
      await servicesFor(req).deliverables.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
