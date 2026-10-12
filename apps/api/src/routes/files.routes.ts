import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });
const tokenQuery = z.object({ token: z.string().min(1) });

/**
 * Downloads are cheap and a page can show many (a wall of Story images, a
 * video fetched in byte ranges), so they get their own, larger allowance
 * instead of spending the per-person API budget.
 */
export const downloadLimit = { rateLimit: { max: 3000, timeWindow: '1 minute' } };

/** Inline for what a browser shows (pictures, video, PDF); download otherwise. */
function disposition(mimeType: string, fileName: string): string {
  const inline = /^(image|video)\//.test(mimeType) || mimeType === 'application/pdf';
  const safe = fileName.replace(/["\\\r\n]/g, '').replace(/[^\x20-\x7e]/g, '_') || 'file';
  return `${inline ? 'inline' : 'attachment'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * File attachments — two-phase signed uploads over private object storage.
 *
 *   1. POST /files            → validate & mint an upload ticket (no DB row yet)
 *   2. PUT  /files/blob       → send the bytes to the API, which writes them to
 *                                private storage (the default for every
 *                                storage setup; with S3_BROWSER_ACCESS=direct
 *                                the browser PUTs a presigned URL instead)
 *   3. POST /files/complete   → confirm the object landed & create the record
 *
 * Downloads never expose a public URL: a signed link to GET /files/:id/blob
 * streams the bytes (byte ranges for video), or, with
 * S3_BROWSER_ACCESS=direct, a presigned GET.
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

  // The upload address. Body is raw bytes (application/octet-stream). The
  // session and the ticket are checked before the body is read, so a forged
  // or someone else's ticket never makes the server take in a large upload.
  r.put(
    '/files/blob',
    {
      onRequest: [
        requireAuth,
        async (req: FastifyRequest) => {
          const token = (req.query as { token?: string }).token ?? '';
          await servicesFor(req).attachments.uploadTicketFor(token);
        },
      ],
      schema: {
        tags: ['Content'],
        summary: 'Upload bytes for a pending attachment (the API writes them to private storage)',
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

  // Signed download link. The token IS the capability, so no session is
  // required — this makes the URL usable in <img>/<video>/<a> — but it is
  // expiring and scoped to exactly this attachment id. Streams the bytes and
  // serves byte ranges, which video players (Safari in particular) need.
  r.get(
    '/files/:id/blob',
    {
      config: downloadLimit,
      // No automatic HEAD: it would open the stored object and never read it.
      exposeHeadRoute: false,
      schema: {
        tags: ['Content'],
        summary: 'Download attachment bytes via a signed link (whole file or a byte range)',
        params: idParam,
        querystring: tokenQuery,
      },
    },
    async (req, reply) => {
      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const file = await servicesFor(req).attachments.openBlobSigned(req.params.id, req.query.token, rangeHeader);
      reply.header('Accept-Ranges', 'bytes').header('X-Content-Type-Options', 'nosniff');
      if (file.status === 416) {
        return reply.status(416).header('Content-Range', `bytes */${file.size}`).send();
      }
      reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', disposition(file.mimeType, file.fileName))
        // The link stays the same for an hour (resolveAttachmentDownloadUrl).
        // no-transform: nothing on the way may compress it (byte ranges and
        // Content-Length must stay true).
        .header('Cache-Control', 'private, max-age=3600, no-transform');
      // A PDF must not be sandboxed, or the browser's viewer refuses it.
      if (file.mimeType !== 'application/pdf') reply.header('Content-Security-Policy', 'sandbox');
      if (file.range) {
        reply
          .status(206)
          .header('Content-Range', `bytes ${file.range.start}-${file.range.end}/${file.size}`)
          .header('Content-Length', String(file.range.end - file.range.start + 1));
      } else {
        reply.header('Content-Length', String(file.size));
      }
      return reply.send(file.stream);
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
