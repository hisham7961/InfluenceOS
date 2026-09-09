import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function noteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/notes',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Add an internal note', body: requests.noteCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).notes.create(req.body);
    },
  );

  r.patch(
    '/notes/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Update a note',
        params: idParam,
        body: z.object({ body: z.string().optional(), pinned: z.boolean().optional() }),
      },
    },
    async (req) => servicesFor(req).notes.update(req.params.id, req.body),
  );

  r.delete(
    '/notes/:id',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Delete a note', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).notes.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
