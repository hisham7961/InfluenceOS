import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });
/** Each call costs money and counts against the month's limit. */
const aiLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/**
 * AI assistance (P3.2): whether it's on for the app, the admin settings
 * (switch, key, model, monthly limit), and reading a post's numbers from its
 * insights screenshot.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/ai/status',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Platform'],
        summary: 'Whether AI assistance is on, and requests left this month',
      },
    },
    async (req) => servicesFor(req).ai.status(),
  );

  r.get(
    '/platform/ai',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Platform'], summary: 'Admin: AI settings and this month’s usage' },
    },
    async (req) => servicesFor(req).ai.settings(),
  );

  r.patch(
    '/platform/ai',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Platform'],
        summary: 'Admin: turn AI on or off, set the Claude API key, model and monthly limit',
        body: requests.aiSettingsUpdateSchema,
      },
    },
    async (req) => servicesFor(req).ai.updateSettings(req.body),
  );

  r.post(
    '/content/:id/metrics/read-screenshot',
    {
      preHandler: [requireAuth],
      config: aiLimit,
      schema: {
        tags: ['Content'],
        summary:
          "Read a post's numbers from its attached insights screenshot (suggestions; nothing is saved)",
        params: idParam,
        body: requests.readMetricsScreenshotSchema,
      },
    },
    async (req) => servicesFor(req).ai.readScreenshot(req.params.id, req.body),
  );
}
