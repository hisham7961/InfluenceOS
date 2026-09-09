import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaigns',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'List/filter campaigns',
        querystring: requests.campaignFilterSchema,
      },
    },
    async (req) => servicesFor(req).campaigns.list(req.query),
  );

  r.post(
    '/campaigns',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Create a campaign', body: requests.campaignCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).campaigns.create(req.body);
    },
  );

  r.get(
    '/campaigns/:idOrSlug',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Get a campaign by id or slug', params: z.object({ idOrSlug: z.string() }) } },
    async (req) => servicesFor(req).campaigns.detail(req.params.idOrSlug),
  );

  r.patch(
    '/campaigns/:id',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Update a campaign', params: idParam, body: requests.campaignUpdateSchema } },
    async (req) => servicesFor(req).campaigns.update(req.params.id, req.body),
  );

  r.get(
    '/campaigns/:id/influencers',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Influencers on a campaign', params: idParam } },
    async (req) => servicesFor(req).campaignInfluencers.listForCampaign(req.params.id),
  );

  r.post(
    '/campaigns/:id/influencers',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Add an influencer to a campaign',
        params: idParam,
        body: requests.campaignInfluencerCreateSchema.omit({ campaignId: true }),
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).campaignInfluencers.add({ ...req.body, campaignId: req.params.id });
    },
  );

  r.get(
    '/campaigns/:id/scripts',
    { preHandler: [requireAuth], schema: { tags: ['Scripts'], summary: 'Scripts for a campaign', params: idParam } },
    async (req) => servicesFor(req).scripts.listForCampaign(req.params.id),
  );

  r.get(
    '/campaigns/:id/costs',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Expenses + cost summary for a campaign', params: idParam } },
    async (req) => servicesFor(req).expenses.listForCampaign(req.params.id),
  );

  r.post(
    '/campaigns/:id/expenses',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Add an expense to a campaign',
        params: idParam,
        body: requests.expenseCreateSchema.omit({ campaignId: true }),
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).expenses.create({ ...req.body, campaignId: req.params.id });
    },
  );
}
