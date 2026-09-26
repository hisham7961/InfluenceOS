import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

/** My work and the cross-campaign approvals list (P3.6). */
export async function workRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/me/work',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Dashboard'],
        summary:
          "What's waiting on me: drafts, deadlines and found posts on what I own, plus my shipments and address issues",
      },
    },
    async (req) => servicesFor(req).work.myWork(),
  );

  r.get(
    '/me/work/counts',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Dashboard'],
        summary: 'Sidebar badges: my open items and drafts waiting for review',
      },
    },
    async (req) => servicesFor(req).work.counts(),
  );

  r.get(
    '/approvals',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary:
          'Drafts waiting for review across campaigns, oldest first (?mine=true: on what I own)',
        querystring: requests.approvalsQuerySchema,
      },
    },
    async (req) => servicesFor(req).work.approvals({ mine: req.query.mine }),
  );
}
