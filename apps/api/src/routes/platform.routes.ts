import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAdmin, requireAuth, servicesFor } from '../http';

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/platform/features',
    { preHandler: [requireAuth], schema: { tags: ['Platform'], summary: 'Feature registry, verbatim' } },
    async (req) => servicesFor(req).platform.features(),
  );

  r.get(
    '/platform/modules',
    { preHandler: [requireAuth], schema: { tags: ['Platform'], summary: 'Per-module rollup of the feature registry' } },
    async (req) => servicesFor(req).platform.modules(),
  );

  r.get(
    '/platform/status',
    { preHandler: [requireAuth], schema: { tags: ['Platform'], summary: 'Live platform status: versions, DB health, mobile-readiness coverage' } },
    async (req) => servicesFor(req).platform.status(),
  );

  r.get(
    '/platform/endpoints',
    { preHandler: [requireAuth], schema: { tags: ['Platform'], summary: 'Flattened API endpoint list with derived auth level' } },
    async (req) => servicesFor(req).platform.endpoints(),
  );

  r.get(
    '/platform/storage',
    { preHandler: [requireAdmin], schema: { tags: ['Platform'], summary: 'Object storage configuration & usage (admin)' } },
    async (req) => servicesFor(req).platform.storageStatus(),
  );

  r.get(
    '/platform/audit',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Platform'],
        summary: 'Admin audit log with server-side filters (admin only)',
        querystring: requests.auditFilterSchema,
      },
    },
    async (req) => servicesFor(req).platform.auditLog(req.query),
  );

  r.get(
    '/platform/flags',
    { preHandler: [requireAdmin], schema: { tags: ['Platform'], summary: 'All feature flags, platform + brand-scoped (admin)' } },
    async (req) => servicesFor(req).platform.getFlags(),
  );

  r.patch(
    '/platform/flags/:key',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Platform'],
        summary: 'Toggle a platform-wide feature flag (admin)',
        params: z.object({ key: z.string() }),
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (req) => servicesFor(req).platform.setFlag(req.params.key, req.body.enabled),
  );

  r.get(
    '/platform/app-versions',
    { preHandler: [requireAdmin], schema: { tags: ['Platform'], summary: 'Mobile app version rules for both platforms (admin)' } },
    async (req) => servicesFor(req).platform.getAppVersions(),
  );

  r.patch(
    '/platform/app-versions/:platform',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Platform'],
        summary: 'Upsert the version/rollout rules for one mobile platform (admin)',
        params: z.object({ platform: z.enum(['IOS', 'ANDROID']) }),
        body: requests.appVersionUpdateSchema,
      },
    },
    async (req) => servicesFor(req).platform.updateAppVersion(req.params.platform, req.body),
  );

  r.patch(
    '/platform/client-config',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Platform'],
        summary: 'Update the client-config singleton (maintenance mode, upload limits, etc) (admin)',
        body: requests.clientConfigUpdateSchema,
      },
    },
    async (req) => servicesFor(req).platform.updateClientConfig(req.body),
  );

  r.get(
    '/client-config',
    { schema: { tags: ['Platform'], summary: 'Public, client-safe remote config for web/mobile bootstrap' } },
    async (req) => servicesFor(req).platform.clientConfig(),
  );
}
