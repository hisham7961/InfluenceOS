import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function influencerRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/influencers',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'List/filter influencers (directory)',
        querystring: requests.influencerFilterSchema,
      },
    },
    async (req) => servicesFor(req).influencers.list(req.query),
  );

  r.post(
    '/influencers',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Create an influencer', body: requests.influencerCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).influencers.create(req.body);
    },
  );

  r.post(
    '/influencers/resolve',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Resolve a pasted profile URL/handle (official data or manual fallback)',
        body: requests.resolveProfileSchema,
      },
    },
    async (req) => servicesFor(req).providers.resolve(req.body.input, req.body.platform ?? null),
  );

  r.get(
    '/influencers/:id',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Influencer 360 profile', params: idParam } },
    async (req) => servicesFor(req).influencers.detail(req.params.id),
  );

  r.patch(
    '/influencers/:id',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Update an influencer', params: idParam, body: requests.influencerUpdateSchema } },
    async (req) => servicesFor(req).influencers.update(req.params.id, req.body),
  );

  r.get(
    '/influencers/:id/social-accounts',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Influencer social accounts', params: idParam } },
    async (req) => servicesFor(req).influencers.socialAccountsFor(req.params.id),
  );

  r.post(
    '/influencers/:id/social-accounts',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Add a social account to an influencer',
        params: idParam,
        body: requests.socialAccountCreateSchema.omit({ influencerId: true }),
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).socialAccounts.create({ ...req.body, influencerId: req.params.id });
    },
  );

  r.get(
    '/influencers/:id/followers',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Follower growth time series', params: idParam } },
    async (req) => servicesFor(req).influencers.followerSeries(req.params.id),
  );

  r.get(
    '/influencers/:id/audience-health',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Audience health signals', params: idParam } },
    async (req) => servicesFor(req).influencers.audienceFor(req.params.id),
  );

  r.get(
    '/influencers/:id/notes',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Internal notes for an influencer', params: idParam } },
    async (req) => servicesFor(req).notes.listForInfluencer(req.params.id),
  );

  r.get(
    '/influencers/:id/brands',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Brand relationships for an influencer', params: idParam } },
    async (req) => servicesFor(req).brandInfluencers.listForInfluencer(req.params.id),
  );
}
