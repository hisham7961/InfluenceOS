import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });
const tokenQuery = z.object({ token: z.string().min(1) });

/**
 * File attachments — two-phase signed uploads over private object storage.
 *
 *   1. POST /files            → validate & mint an upload ticket (no DB row yet)
 *   2. PUT  /files/blob       → (local driver) upload bytes to the signed proxy;
 *                                S3 clients PUT straight to the presigned URL
 *   3. POST /files/complete   → confirm the object landed & create the record
 *
 * Downloads never expose a public URL: S3 uses presigned GET, the local driver
 * uses a short-lived signed proxy link (GET /files/:id/blob?token=...).
 */
export async function fileRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/files',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Initiate an upload (phase 1 — returns a signed upload ticket)',
        body: requests.attachmentInitiateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).attachments.initiate(req.body);
    },
  );

  // Local-driver upload proxy. Body is raw bytes (application/octet-stream).
  r.put(
    '/files/blob',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Upload bytes for a pending attachment (local driver proxy)',
        querystring: tokenQuery,
        consumes: ['application/octet-stream'],
      },
    },
    async (req, reply) => {
      const body = req.body as Buffer;
      await servicesFor(req).attachments.writeBlob(req.query.token, Buffer.isBuffer(body) ? body : Buffer.from([]));
      reply.status(204).send();
    },
  );

  r.post(
    '/files/complete',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Complete an upload (phase 2 — verifies storage & creates the record)',
        body: requests.attachmentCompleteSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).attachments.complete(req.body.uploadToken);
    },
  );

  r.get(
    '/files',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'List attachments for a target',
        querystring: requests.attachmentListQuerySchema,
      },
    },
    async (req) => servicesFor(req).attachments.list(req.query),
  );

  r.get(
    '/files/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Get an attachment', params: idParam } },
    async (req) => servicesFor(req).attachments.get(req.params.id),
  );

  // Signed download proxy (local driver). The token IS the capability, so no
  // session is required — this makes the URL usable in <img>/<a> — but it is
  // short-lived and scoped to exactly this attachment id.
  r.get(
    '/files/:id/blob',
    {
      schema: {
        tags: ['Content'],
        summary: 'Download attachment bytes via a signed link (local driver)',
        params: idParam,
        querystring: tokenQuery,
      },
    },
    async (req, reply) => {
      const { buffer, mimeType, fileName } = await servicesFor(req).attachments.readBlobSigned(
        req.params.id,
        req.query.token,
      );
      reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`)
        .header('Cache-Control', 'private, max-age=300')
        .send(buffer);
    },
  );

  r.delete(
    '/files/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Delete an attachment', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).attachments.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
