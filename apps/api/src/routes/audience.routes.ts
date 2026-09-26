import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Audience insights (P3.7): who follows each of a creator's accounts, as the
 * team types it from the creator's insights screenshot.
 */
export async function audienceRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/influencers/:id/audience',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: "Audience insights for a creator's accounts, newest first",
        params: idParam,
      },
    },
    async (req) => servicesFor(req).audience.listForInfluencer(req.params.id),
  );

  r.post(
    '/social-accounts/:id/audience',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: "Add audience insights for one of a creator's accounts",
        params: idParam,
        body: requests.audienceInsightCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).audience.create(req.params.id, req.body);
    },
  );

  r.patch(
    '/audience/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Correct audience insights',
        params: idParam,
        body: requests.audienceInsightUpdateSchema,
      },
    },
    async (req) => servicesFor(req).audience.update(req.params.id, req.body),
  );

  r.delete(
    '/audience/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Influencers'], summary: 'Remove audience insights', params: idParam },
    },
    async (req, reply) => {
      await servicesFor(req).audience.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
