import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function campaignInfluencerRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaign-influencers/:id',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Campaign influencer detail', params: idParam } },
    async (req) => servicesFor(req).campaignInfluencers.get(req.params.id),
  );

  r.patch(
    '/campaign-influencers/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Update a campaign influencer (deal, status, notes)',
        params: idParam,
        body: requests.campaignInfluencerUpdateSchema,
      },
    },
    async (req) => servicesFor(req).campaignInfluencers.update(req.params.id, req.body),
  );

  r.delete(
    '/campaign-influencers/:id',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Remove an influencer from a campaign', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).campaignInfluencers.remove(req.params.id);
      reply.status(204).send();
    },
  );

  r.post(
    '/campaign-influencers/:id/deliverables',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Add a deliverable to a campaign influencer',
        params: idParam,
        body: requests.deliverableCreateSchema.omit({ campaignInfluencerId: true }),
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).deliverables.create({ ...req.body, campaignInfluencerId: req.params.id });
    },
  );
}
