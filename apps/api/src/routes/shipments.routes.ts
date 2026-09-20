import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Logistics fulfilment requests, keyed by their own id (evolved from W3-5's
 * one-shipment-per-campaign-influencer shape — see
 * docs/workflow/WORKFLOW_GAP_MATRIX.md). Creating one lives under
 * /campaign-influencers/:id/shipments (campaign-influencers.routes.ts),
 * because a shipment is always created FROM a specific campaign
 * participation; everything after creation is keyed by the shipment's own id.
 */
export async function shipmentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // The cross-campaign `/logistics` workspace — reads the same rows every
  // other view reads, never a copy.
  r.get(
    '/shipments',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Logistics'], summary: 'Cross-campaign logistics workspace list', querystring: requests.shipmentFilterSchema },
    },
    async (req) => servicesFor(req).shipments.listAll(req.query),
  );

  r.get(
    '/shipments/:id',
    { preHandler: [requireAuth], schema: { tags: ['Logistics'], summary: 'Get one shipment', params: idParam } },
    async (req) => servicesFor(req).shipments.get(req.params.id),
  );

  r.patch(
    '/shipments/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Logistics'],
        summary: 'Update shipment fulfilment details (address, courier, tracking, notes)',
        params: idParam,
        body: requests.shipmentUpdateSchema,
      },
    },
    async (req) => servicesFor(req).shipments.update(req.params.id, req.body),
  );

  r.post(
    '/shipments/:id/status',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Logistics'],
        summary: 'Advance the shipment fulfilment status',
        params: idParam,
        body: requests.shipmentStatusSchema,
      },
    },
    async (req) => servicesFor(req).shipments.updateStatus(req.params.id, req.body),
  );
}
