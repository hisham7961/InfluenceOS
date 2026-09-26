import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Sales & ROI (P3.1): promo codes and tracking links per creator, the
 * brand's sales credited to them (shop file or entered by hand), and the
 * public endpoint behind the short links.
 */
export async function salesRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/campaigns/:id/sales',
    { preHandler: [requireAuth], schema: { tags: ['Sales'], summary: "A campaign's codes, links, sales and return on spend", params: idParam } },
    async (req) => servicesFor(req).sales.campaignSales(req.params.id),
  );

  r.post(
    '/campaigns/:id/promo-codes',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Sales'], summary: 'Give a creator a promo code', params: idParam, body: requests.promoCodeCreateSchema },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).sales.createPromoCode(req.params.id, req.body);
    },
  );

  r.patch(
    '/promo-codes/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Sales'], summary: 'Change a promo code (or turn it off)', params: idParam, body: requests.promoCodeUpdateSchema },
    },
    async (req) => servicesFor(req).sales.updatePromoCode(req.params.id, req.body),
  );

  r.delete(
    '/promo-codes/:id',
    { preHandler: [requireAuth], schema: { tags: ['Sales'], summary: 'Delete a promo code with no sales', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).sales.deletePromoCode(req.params.id);
      reply.status(204).send();
    },
  );

  r.post(
    '/campaigns/:id/tracking-links',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Sales'], summary: 'Make a tracking link for a creator', params: idParam, body: requests.trackingLinkCreateSchema },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).sales.createTrackingLink(req.params.id, req.body);
    },
  );

  r.patch(
    '/tracking-links/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Sales'], summary: 'Change or pause a tracking link', params: idParam, body: requests.trackingLinkUpdateSchema },
    },
    async (req) => servicesFor(req).sales.updateTrackingLink(req.params.id, req.body),
  );

  r.delete(
    '/tracking-links/:id',
    { preHandler: [requireAuth], schema: { tags: ['Sales'], summary: 'Delete a tracking link', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).sales.deleteTrackingLink(req.params.id);
      reply.status(204).send();
    },
  );

  r.post(
    '/campaigns/:id/sales',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Sales'], summary: 'Record sales for a creator by hand', params: idParam, body: requests.saleCreateSchema },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).sales.addSale(req.params.id, req.body);
    },
  );

  r.delete(
    '/sales/:id',
    { preHandler: [requireAuth], schema: { tags: ['Sales'], summary: 'Delete a recorded sale', params: idParam } },
    async (req, reply) => {
      await servicesFor(req).sales.deleteSale(req.params.id);
      reply.status(204).send();
    },
  );

  r.post(
    '/brands/:id/sales/import',
    {
      preHandler: [requireAuth],
      // Up to 20,000 order rows.
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        tags: ['Sales'],
        summary: "Credit the brand's shop orders to creators by code or link (dryRun to check first)",
        params: idParam,
        body: requests.salesImportSchema,
      },
    },
    async (req) => servicesFor(req).sales.importSales(req.params.id, req.body),
  );

  r.delete(
    '/sales-imports/:id',
    { preHandler: [requireAuth], schema: { tags: ['Sales'], summary: 'Undo a sales file (removes its orders)', params: idParam } },
    async (req) => servicesFor(req).sales.undoImport(req.params.id),
  );

  // Public: the web app's /r/<slug> asks where to send the visitor. No
  // sign-in; a person's visit is counted, previews and scripts aren't.
  r.get(
    '/public/links/:slug',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['Sales'],
        summary: 'Where a tracking link goes (counts the click)',
        security: [],
        params: z.object({ slug: z.string().min(1).max(40) }),
        querystring: z.object({ preview: z.enum(['0', '1', 'true', 'false']).optional() }),
      },
    },
    async (req) =>
      servicesFor(req).sales.resolveLink(req.params.slug, {
        userAgent: req.headers['user-agent'] ?? null,
        method: req.query.preview === '1' || req.query.preview === 'true' ? 'HEAD' : 'GET',
      }),
  );
}
