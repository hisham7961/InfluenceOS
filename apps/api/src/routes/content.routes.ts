import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/content/feed',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Live Content feed (cursor-paginated, media-independent DTOs)',
        querystring: requests.contentFilterSchema,
      },
    },
    async (req) => servicesFor(req).content.feed(req.query),
  );

  r.post(
    '/content',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Add published content by URL (auto-detects platform, links deliverable)',
        body: requests.publishedContentCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).content.create(req.body);
    },
  );

  r.get(
    '/content/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Content detail + embed descriptor', params: idParam } },
    async (req) => servicesFor(req).content.detail(req.params.id),
  );

  r.patch(
    '/content/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Update content (caption, associations, manual status)', params: idParam, body: requests.publishedContentUpdateSchema } },
    async (req) => servicesFor(req).content.update(req.params.id, req.body),
  );

  r.get(
    '/content/:id/metrics',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Metric snapshot history', params: idParam } },
    async (req) => servicesFor(req).content.metricsHistory(req.params.id),
  );

  r.post(
    '/content/:id/metrics',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Add manual metrics (platforms without an official API)', params: idParam, body: requests.contentMetricSchema } },
    async (req) => servicesFor(req).content.addManualMetrics(req.params.id, req.body),
  );

  r.get(
    '/content/:id/monitoring',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Content monitoring events', params: idParam } },
    async (req) => servicesFor(req).content.monitoring(req.params.id),
  );

  r.post(
    '/content/:id/refresh',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Refresh availability + metrics via the platform adapter', params: idParam } },
    async (req) => servicesFor(req).content.refresh(req.params.id),
  );
}
