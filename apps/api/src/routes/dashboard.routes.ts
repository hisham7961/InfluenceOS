import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const brandQuery = z.object({ brandId: z.string().optional() });

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/dashboard/global',
    { preHandler: [requireAuth], schema: { tags: ['Dashboard'], summary: 'Global Mission Control (optionally brand-scoped)', querystring: brandQuery } },
    async (req) => servicesFor(req).dashboard.global(req.query.brandId),
  );

  r.get(
    '/dashboard/attention',
    { preHandler: [requireAuth], schema: { tags: ['Dashboard'], summary: 'Items that need attention', querystring: brandQuery } },
    async (req) => servicesFor(req).dashboard.attention(req.query.brandId),
  );

  r.get(
    '/whats-new',
    { preHandler: [requireAuth], schema: { tags: ['Dashboard'], summary: "What's New feed", querystring: brandQuery } },
    async (req) => servicesFor(req).dashboard.whatsNew(req.query.brandId),
  );
}
