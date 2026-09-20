import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function noteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // List a thread's top-level messages (one level of replies inlined),
  // cursor-paginated — the shared Collaboration Layer's one read path for
  // Content/Deliverable/Shipment/Inspiration comments and Campaign/General chat.
  r.get(
    '/notes',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Collaboration'], summary: 'List a context thread (comments/chat)', querystring: requests.noteListQuerySchema },
    },
    async (req) => {
      const { cursor, limit, ...context } = req.query;
      return servicesFor(req).notes.list(context, { cursor, limit });
    },
  );

  r.post(
    '/notes',
    { preHandler: [requireAuth], schema: { tags: ['Collaboration'], summary: 'Post a message (note/comment/chat/reply)', body: requests.noteCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).notes.create(req.body);
    },
  );

  r.patch(
    '/notes/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Collaboration'],
        summary: 'Update a note (backward-compatible: body and/or pinned)',
        params: idParam,
        body: z.object({ body: z.string().optional(), pinned: z.boolean().optional() }),
      },
    },
    async (req) => servicesFor(req).notes.update(req.params.id, req.body),
  );

  r.patch(
    '/notes/:id/body',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Collaboration'], summary: 'Edit a message body (author or admin only)', params: idParam, body: requests.noteEditSchema },
    },
    async (req) => servicesFor(req).notes.editBody(req.params.id, req.body.body),
  );

  r.patch(
    '/notes/:id/pin',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Collaboration'],
        summary: 'Pin or unpin a message (admin, campaign owner, or author only)',
        params: idParam,
        body: requests.notePinSchema,
      },
    },
    async (req) => servicesFor(req).notes.pin(req.params.id, req.body.pinned),
  );

  r.delete(
    '/notes/:id',
    { preHandler: [requireAuth], schema: { tags: ['Collaboration'], summary: 'Delete a message', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).notes.remove(req.params.id);
      reply.status(204).send();
    },
  );

  r.get(
    '/notes/mentions',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Collaboration'], summary: 'Messages that @mention the current user', querystring: requests.mentionsQuerySchema },
    },
    async (req) => servicesFor(req).notes.listMentionsForUser(req.query),
  );

  r.post(
    '/notes/conversations/read',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Collaboration'], summary: 'Mark a Campaign Chat / General channel as read up to now', body: requests.conversationReadSchema },
    },
    async (req) => {
      const lastReadAt = await servicesFor(req).notes.markConversationRead(req.body.conversationKey);
      return { lastReadAt };
    },
  );
}
