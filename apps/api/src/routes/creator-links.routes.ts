import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });
const tokenParam = z.object({ token: z.string().min(20).max(64) });
const taskParams = tokenParam.extend({ deliverableId: z.string().min(1).max(40) });

/**
 * Creator task links (P3.3): a creator's part of one campaign without an
 * account. The team makes and turns off the links; the public endpoints
 * behind /share/c/<token> take no sign-in and only ever touch that
 * creator's own deliverables.
 */
export async function creatorLinkRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaign-influencers/:id/creator-links',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: "A creator's task links on a campaign",
        params: idParam,
      },
    },
    async (req) => servicesFor(req).creatorLinks.list(req.params.id),
  );

  r.post(
    '/campaign-influencers/:id/creator-links',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Make a task link for a creator (no sign-in; brief, tasks, drafts, feedback)',
        params: idParam,
        body: requests.creatorLinkCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).creatorLinks.create(req.params.id, req.body);
    },
  );

  r.post(
    '/creator-links/:id/revoke',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Campaigns'], summary: 'Turn off a creator task link', params: idParam },
    },
    async (req) => servicesFor(req).creatorLinks.revoke(req.params.id),
  );

  r.get(
    '/public/creator/:token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['Campaigns'],
        summary: "A creator's tasks on a campaign (no sign-in; counts the visit)",
        security: [],
        params: tokenParam,
        querystring: z.object({ preview: z.enum(['0', '1', 'true', 'false']).optional() }),
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return servicesFor(req).creatorLinks.open(req.params.token, {
        userAgent: req.headers['user-agent'] ?? null,
        preview: req.query.preview === '1' || req.query.preview === 'true',
      });
    },
  );

  const sendLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  // The creator uploads the draft file itself (a photo or a video) instead
  // of a link: 1) ask where to send it, 2) send the bytes (straight to
  // storage, or to /uploads below), 3) send the draft with the upload token.
  r.post(
    '/public/creator/:token/deliverables/:deliverableId/uploads',
    {
      config: sendLimit,
      schema: {
        tags: ['Campaigns'],
        summary: 'The creator starts uploading a draft file (photo or video) from their task link',
        security: [],
        params: taskParams,
        body: requests.creatorDraftUploadSchema,
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      reply.status(201);
      return servicesFor(req).creatorLinks.startUpload(
        req.params.token,
        req.params.deliverableId,
        req.body,
      );
    },
  );

  r.put(
    '/public/creator/:token/uploads',
    {
      config: sendLimit,
      schema: {
        tags: ['Campaigns'],
        summary: "The draft file's bytes (when storage can't take them directly)",
        security: [],
        params: tokenParam,
        querystring: z.object({ ticket: z.string().min(1).max(4000) }),
        consumes: ['application/octet-stream'],
      },
    },
    async (req, reply) => {
      const body = req.body as Buffer;
      await servicesFor(req).creatorLinks.writeUpload(
        req.params.token,
        req.query.ticket,
        Buffer.isBuffer(body) ? body : Buffer.from([]),
      );
      reply.status(204).send();
    },
  );

  r.post(
    '/public/creator/:token/deliverables/:deliverableId/drafts',
    {
      config: sendLimit,
      schema: {
        tags: ['Campaigns'],
        summary:
          'The creator sends a draft for review (a link to watch it, the planned caption, a note)',
        security: [],
        params: taskParams,
        body: requests.creatorDraftSchema,
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return servicesFor(req).creatorLinks.sendDraft(
        req.params.token,
        req.params.deliverableId,
        req.body,
      );
    },
  );

  r.post(
    '/public/creator/:token/deliverables/:deliverableId/posted',
    {
      config: sendLimit,
      schema: {
        tags: ['Campaigns'],
        summary: 'The creator sends the link to their live post, for the team to check and add',
        security: [],
        params: taskParams,
        body: requests.creatorPostedSchema,
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return servicesFor(req).creatorLinks.sendPost(
        req.params.token,
        req.params.deliverableId,
        req.body,
      );
    },
  );
}
