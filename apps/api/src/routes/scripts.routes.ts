import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/scripts/:id',
    { preHandler: [requireAuth], schema: { tags: ['Scripts'], summary: 'Script detail with version history', params: idParam } },
    async (req) => servicesFor(req).scripts.detail(req.params.id),
  );

  r.post(
    '/scripts',
    { preHandler: [requireAuth], schema: { tags: ['Scripts'], summary: 'Create a script reference (with its first version)', body: requests.scriptCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).scripts.create(req.body);
    },
  );

  r.post(
    '/scripts/:id/versions',
    { preHandler: [requireAuth], schema: { tags: ['Scripts'], summary: 'Add a new version to a script reference', params: idParam, body: requests.scriptVersionSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).scripts.addVersion(req.params.id, req.body);
    },
  );
}
