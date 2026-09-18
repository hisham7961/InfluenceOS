import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { CANDIDATE_STATUSES } from '@influenceos/shared';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Sourcing / shortlist candidate pipeline (W3-3). Candidates are considered,
 * shortlisted, approved or rejected under a campaign BEFORE any roster commit;
 * only `convert` creates the CampaignInfluencer roster row.
 */
export async function candidateRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaigns/:id/candidates',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'List sourcing candidates for a campaign',
        params: idParam,
        querystring: z.object({ status: z.enum(CANDIDATE_STATUSES).optional() }),
      },
    },
    async (req) => servicesFor(req).sourcing.listForCampaign(req.params.id, req.query.status),
  );

  r.post(
    '/campaigns/:id/candidates',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Add a creator to the sourcing pipeline',
        params: idParam,
        body: requests.candidateCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).sourcing.add(req.params.id, req.body);
    },
  );

  r.get(
    '/candidates/:id',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Get a sourcing candidate', params: idParam } },
    async (req) => servicesFor(req).sourcing.get(req.params.id),
  );

  r.patch(
    '/candidates/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Update a candidate (fit score / notes)',
        params: idParam,
        body: requests.candidateUpdateSchema,
      },
    },
    async (req) => servicesFor(req).sourcing.update(req.params.id, req.body),
  );

  r.post(
    '/candidates/:id/decision',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Decide on a candidate (shortlist / approve / reject / reconsider)',
        params: idParam,
        body: requests.candidateDecisionSchema,
      },
    },
    async (req) => servicesFor(req).sourcing.decide(req.params.id, req.body),
  );

  r.post(
    '/candidates/:id/convert',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Commit an approved/shortlisted candidate to the campaign roster',
        params: idParam,
        body: requests.candidateConvertSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).sourcing.convert(req.params.id, req.body);
    },
  );

  r.delete(
    '/candidates/:id',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Remove a candidate from the pipeline', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).sourcing.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
