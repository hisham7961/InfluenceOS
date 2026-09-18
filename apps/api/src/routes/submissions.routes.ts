import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Deliverable submission review/approval workflow (W3-1). Submissions live under
 * a deliverable; each is reviewed (approve / request-changes / reject) and
 * carries a comment thread. Approving completes the deliverable without a public
 * URL, so genuine UGC is trackable.
 */
export async function submissionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/deliverables/:id/submissions',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'List submissions for a deliverable', params: idParam } },
    async (req) => servicesFor(req).submissions.listForDeliverable(req.params.id),
  );

  r.post(
    '/deliverables/:id/submissions',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Submit a draft for review',
        params: idParam,
        body: requests.submissionCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).submissions.create(req.params.id, req.body);
    },
  );

  r.get(
    '/submissions/:id',
    { preHandler: [requireAuth], schema: { tags: ['Campaigns'], summary: 'Get a submission', params: idParam } },
    async (req) => servicesFor(req).submissions.get(req.params.id),
  );

  r.post(
    '/submissions/:id/review',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Review a submission (approve / request changes / reject)',
        params: idParam,
        body: requests.submissionReviewSchema,
      },
    },
    async (req) => servicesFor(req).submissions.review(req.params.id, req.body),
  );

  r.post(
    '/submissions/:id/comments',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Add a review comment to a submission',
        params: idParam,
        body: requests.submissionCommentSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).submissions.addComment(req.params.id, req.body);
    },
  );
}
