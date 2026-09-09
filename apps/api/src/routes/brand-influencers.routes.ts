import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

export async function brandInfluencerRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/brand-influencers',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Create or update a brand-influencer relationship',
        body: requests.brandInfluencerSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).brandInfluencers.upsert(req.body);
    },
  );

  r.delete(
    '/brand-influencers/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Remove a brand-influencer relationship',
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      await servicesFor(req).brandInfluencers.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
