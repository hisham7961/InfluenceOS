import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { PLATFORMS } from '@influenceos/shared';
import { requireAdmin, requireAuth, servicesFor } from '../http';

const platformParam = z.object({ platform: z.enum(PLATFORMS) });

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/integrations',
    { preHandler: [requireAuth], schema: { tags: ['Settings'], summary: 'List integration settings for all platforms' } },
    async (req) => servicesFor(req).integrations.list(),
  );

  r.get(
    '/integrations/capabilities',
    { preHandler: [requireAuth], schema: { tags: ['Settings'], summary: 'Live provider capability snapshot for all platforms' } },
    async (req) => servicesFor(req).providers.capabilities(),
  );

  r.patch(
    '/integrations/:platform',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: 'Update an integration (admin)',
        params: platformParam,
        body: requests.integrationUpdateSchema,
      },
    },
    async (req) => servicesFor(req).integrations.update(req.params.platform, req.body),
  );

  r.post(
    '/integrations/:platform/test',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: 'Run a live connectivity test for an integration (admin)',
        params: platformParam,
      },
    },
    async (req) => servicesFor(req).integrations.test(req.params.platform),
  );
}
