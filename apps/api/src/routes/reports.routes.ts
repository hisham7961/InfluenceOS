import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
import { reportToCsv, requireAuth, sendCsv, servicesFor } from '../http';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/reports',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Reports'],
        summary: 'Generate an analytics report (JSON or CSV)',
        querystring: requests.reportFilterSchema,
      },
    },
    async (req, reply) => {
      const services = servicesFor(req);
      const report = await services.reports.generate(req.query);
      if (req.query.format === 'csv') {
        sendCsv(reply, `influenceos-${req.query.type}-report.csv`, reportToCsv(report));
        return reply;
      }
      return report;
    },
  );
}
