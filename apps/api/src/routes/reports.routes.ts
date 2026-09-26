import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests } from '@influenceos/contracts';
import { csvLocale, reportToCsv, requireAuth, sendCsv, servicesFor } from '../http';

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
        sendCsv(reply, `influenceos-${req.query.type}-report.csv`, reportToCsv(report, await csvLocale(req, req.query.locale)));
        return reply;
      }
      return report;
    },
  );

  r.get(
    '/reports/leaderboard',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Reports'],
        summary: 'Creator performance leaderboard (server-computed, W6-2)',
        querystring: requests.leaderboardQuerySchema,
      },
    },
    async (req) => servicesFor(req).analytics.creatorLeaderboard(req.query),
  );

  r.get(
    '/reports/exec-dashboard',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Reports'],
        summary: 'Executive overview: spend vs budget per currency, results this period vs the one before, today, since yesterday, cross-brand rollup',
        querystring: requests.execDashboardQuerySchema,
      },
    },
    async (req) => servicesFor(req).analytics.executiveDashboard(req.query),
  );

  r.get(
    '/reports/trends',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Reports'],
        summary: 'Week- or month-by-month results (posts, views, engagements, deliverables, payments with finance access), Kuwait time',
        querystring: requests.trendsQuerySchema,
      },
    },
    async (req) => servicesFor(req).analytics.trends(req.query),
  );

  r.get(
    '/reports/benchmarks',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Reports'],
        summary:
          'Rate benchmarks from past confirmed paid bookings: fee per post, cost per view and engagement rate (median and middle half) by platform and follower tier when booked; fee figures need finance access',
        querystring: requests.benchmarkQuerySchema,
      },
    },
    async (req) => servicesFor(req).benchmarks.benchmarks(req.query),
  );
}
