import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Post discovery (P3.4): posts found on the roster creators' own accounts
 * while their campaign runs, suggested for the campaign until someone adds
 * or dismisses them.
 */
export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaigns/:id/discovered-posts',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: "Posts found on the campaign's creators' accounts (new, added or dismissed)",
        params: idParam,
        querystring: requests.discoveredPostListSchema,
      },
    },
    async (req) => servicesFor(req).discovery.listForCampaign(req.params.id, req.query.status),
  );

  r.post(
    '/campaigns/:id/discover-posts',
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['Content'],
        summary: "Look for new posts on the campaign's creators' accounts now",
        params: idParam,
      },
    },
    async (req) => servicesFor(req).discovery.discoverForCampaign(req.params.id),
  );

  r.post(
    '/discovered-posts/:id/add',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Add a found post to its campaign as tracked content',
        params: idParam,
        body: requests.discoveredPostAddSchema,
      },
    },
    async (req) => servicesFor(req).discovery.add(req.params.id, req.body),
  );

  r.post(
    '/discovered-posts/:id/dismiss',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Not campaign work: never suggest this post again',
        params: idParam,
      },
    },
    async (req) => servicesFor(req).discovery.dismiss(req.params.id),
  );
}
