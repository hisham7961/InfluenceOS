import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const brandQuery = z.object({ brandId: z.string().optional() });

export async function dataQualityRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/data-quality/report',
    { preHandler: [requireAuth], schema: { tags: ['Data Quality'], summary: 'Missing/incomplete-data findings (optionally brand-scoped)', querystring: brandQuery } },
    async (req) => servicesFor(req).dataQuality.report(req.query.brandId),
  );

  r.get(
    '/data-quality/duplicates',
    { preHandler: [requireAuth], schema: { tags: ['Data Quality'], summary: 'Possible duplicate creator candidates (optionally brand-scoped)', querystring: brandQuery } },
    async (req) => servicesFor(req).dataQuality.duplicates(req.query.brandId),
  );
}
