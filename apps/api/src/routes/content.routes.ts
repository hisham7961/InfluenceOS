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

  // A Story screenshot/recording — no live URL to link (Stories expire), so
  // this creates the PublishedContent row up front; the caller then uploads
  // the actual media as an Attachment targeting the returned id (two-phase
  // upload via POST /files/initiate + /files/complete, same as every other
  // attachment). Placed before /content/:id so "story" is never captured as
  // an :id param.
  r.post(
    '/content/story',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Add a Story (screenshot/recording) — creates the content row; upload the media as a follow-up attachment',
        body: requests.publishedContentStoryCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).content.createStory(req.body);
    },
  );

  // Content Command Center pass — one efficient call for the top filter
  // chips, the daily summary panel and the By Brand overview. Placed before
  // /content/:id so "summary" is never captured as an :id param.
  r.get(
    '/content/summary',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Content'], summary: 'Per-user content counts + brand aggregation', querystring: requests.contentSummaryQuerySchema },
    },
    async (req) => servicesFor(req).content.summary(req.query),
  );

  r.get(
    '/content/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Content detail + embed descriptor', params: idParam } },
    async (req) => servicesFor(req).content.detail(req.params.id),
  );

  r.patch(
    '/content/:id/view-state',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Content'],
        summary: 'Mark seen / reviewed / review-later for the calling user (Content Command Center)',
        params: idParam,
        body: requests.contentViewStateSchema,
      },
    },
    async (req) => servicesFor(req).content.updateViewState(req.params.id, req.body),
  );

  r.get(
    '/content/:id/notes',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Internal notes on this content', params: idParam } },
    async (req) => servicesFor(req).notes.listForContent(req.params.id),
  );

  r.patch(
    '/content/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Update content (caption, associations, manual status)', params: idParam, body: requests.publishedContentUpdateSchema } },
    async (req) => servicesFor(req).content.update(req.params.id, req.body),
  );

  r.delete(
    '/content/:id',
    { preHandler: [requireAuth], schema: { tags: ['Content'], summary: 'Delete published content', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).content.remove(req.params.id);
      reply.status(204).send();
    },
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
