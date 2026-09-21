import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
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

  r.post(
    '/data-quality/duplicates/check',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Data Quality'],
        summary: 'Live duplicate check for a single candidate (Add Influencer / import), across all brands',
        body: requests.duplicateCheckSchema,
      },
    },
    async (req) => servicesFor(req).dataQuality.checkDuplicate(req.body),
  );
}
