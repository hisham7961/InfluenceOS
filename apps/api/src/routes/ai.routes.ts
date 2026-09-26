import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });
/** Each call costs money and counts against the month's limit. */
const aiLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/**
 * AI assistance (P3.2 / P3.5): whether it's on for the app, the admin
 * settings (switch, key, model, monthly limit), reading a post's numbers from
 * its insights screenshot, and writing help.
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

  // Writing help (P3.5): suggestions for the team to edit — nothing is saved.
  r.post(
    '/campaigns/:id/scripts/ai-draft',
    {
      preHandler: [requireAuth],
      config: aiLimit,
      schema: {
        tags: ['Campaigns'],
        summary: 'AI: a first draft of a script version from the campaign brief (nothing is saved)',
        params: idParam,
        body: requests.scriptDraftRequestSchema,
      },
    },
    async (req) => servicesFor(req).aiWriting.draftScript(req.params.id, req.body),
  );

  r.post(
    '/submissions/:id/ai-review',
    {
      preHandler: [requireAuth],
      config: aiLimit,
      schema: {
        tags: ['Deliverables'],
        summary: "AI: suggested review notes on a creator's draft (nothing is saved)",
        params: idParam,
        body: requests.draftReviewRequestSchema,
      },
    },
    async (req) => servicesFor(req).aiWriting.reviewDraft(req.params.id, req.body.language),
  );

  r.post(
    '/campaigns/:id/report/ai-summary',
    {
      preHandler: [requireAuth],
      config: aiLimit,
      schema: {
        tags: ['Campaigns'],
        summary:
          "AI: a short summary of the campaign's results for the client report (nothing is saved)",
        params: idParam,
        body: requests.reportSummaryRequestSchema,
      },
    },
    async (req) => servicesFor(req).aiWriting.summarizeReport(req.params.id, req.body.language),
  );
}
