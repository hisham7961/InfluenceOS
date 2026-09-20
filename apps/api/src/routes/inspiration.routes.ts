import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Trends & Inspiration (Operations Intelligence pass) — external reference
 * material the team wants to remember and discuss, never PublishedContent.
 * Discussion on an item goes through /notes with inspirationItemId set (the
 * shared Collaboration Layer), not a route here.
 */
export async function inspirationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/inspiration',
    { preHandler: [requireAuth], schema: { tags: ['Inspiration'], summary: 'List trends & inspiration items', querystring: requests.inspirationFilterSchema } },
    async (req) => servicesFor(req).inspiration.list(req.query),
  );

  r.get(
    '/inspiration/:id',
    { preHandler: [requireAuth], schema: { tags: ['Inspiration'], summary: 'Get one inspiration item', params: idParam } },
    async (req) => servicesFor(req).inspiration.get(req.params.id),
  );

  r.post(
    '/inspiration',
    { preHandler: [requireAuth], schema: { tags: ['Inspiration'], summary: 'Save a trend/inspiration item', body: requests.inspirationCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).inspiration.create(req.body);
    },
  );

  r.patch(
    '/inspiration/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Inspiration'], summary: 'Update an inspiration item', params: idParam, body: requests.inspirationUpdateSchema },
    },
    async (req) => servicesFor(req).inspiration.update(req.params.id, req.body),
  );

  r.delete(
    '/inspiration/:id',
    { preHandler: [requireAuth], schema: { tags: ['Inspiration'], summary: 'Remove an inspiration item', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).inspiration.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
