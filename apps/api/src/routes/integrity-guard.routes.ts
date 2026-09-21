import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const brandQuery = z.object({ brandId: z.string().optional() });

export async function integrityGuardRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/integrity/findings',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Data Quality'], summary: 'Relational-consistency findings across content/deliverables/campaigns (optionally brand-scoped)', querystring: brandQuery },
    },
    async (req) => servicesFor(req).integrityGuard.findings(req.query.brandId),
  );
}
