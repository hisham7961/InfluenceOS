import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';
import { campaignReportXlsx, reportFileBase } from '../lib/campaign-report-xlsx';

const idParam = z.object({ id: z.string() });
const tokenParam = z.object({ token: z.string().min(20).max(64) });
const previewQuery = z.object({ preview: z.enum(['0', '1', 'true', 'false']).optional() });

/**
 * Client report links (P3.3): a campaign's report shared with the brand's
 * team without an account. The public endpoints behind /share/r/<token> take
 * no sign-in; the link decides the language and whether costs show.
 */
export async function reportShareRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaigns/:id/report-shares',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Campaigns'], summary: "A campaign's client report links", params: idParam },
    },
    async (req) => servicesFor(req).reportShares.list(req.params.id),
  );

  r.post(
    '/campaigns/:id/report-shares',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Share the client report by link (no sign-in; costs off unless chosen)',
        params: idParam,
        body: requests.reportShareCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).reportShares.create(req.params.id, req.body);
    },
  );

  r.post(
    '/report-shares/:id/revoke',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Campaigns'], summary: 'Turn off a client report link', params: idParam },
    },
    async (req) => servicesFor(req).reportShares.revoke(req.params.id),
  );

  const publicLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

  r.get(
    '/public/reports/:token',
    {
      config: publicLimit,
      schema: {
        tags: ['Campaigns'],
        summary: 'A shared client report (no sign-in; counts the visit)',
        security: [],
        params: tokenParam,
        querystring: previewQuery,
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return servicesFor(req).reportShares.open(req.params.token, {
        userAgent: req.headers['user-agent'] ?? null,
        preview: req.query.preview === '1' || req.query.preview === 'true',
      });
    },
  );

  r.get(
    '/public/reports/:token/xlsx',
    {
      config: publicLimit,
      schema: {
        tags: ['Campaigns'],
        summary: 'A shared client report as an Excel workbook',
        security: [],
        params: tokenParam,
      },
    },
    async (req, reply) => {
      const report = await servicesFor(req).reportShares.open(req.params.token, {
        userAgent: req.headers['user-agent'] ?? null,
        preview: true,
      });
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header(
          'Content-Disposition',
          `attachment; filename="${reportFileBase(report)}-report-${report.locale}.xlsx"`,
        )
        .header('Cache-Control', 'private, no-store');
      return reply.send(campaignReportXlsx(report));
    },
  );
}
