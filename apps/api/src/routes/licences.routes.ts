import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

/**
 * Creator advertising licences (P3.5): the records on a creator, the check
 * of a campaign's roster against the campaign's countries, and the admin
 * setting for which countries need a licence.
 */
export async function licenceRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/influencers/:id/licences',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: "A creator's advertising licences",
        params: idParam,
      },
    },
    async (req) => servicesFor(req).licences.listForInfluencer(req.params.id),
  );

  r.post(
    '/influencers/:id/licences',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: "Record a creator's advertising licence for a country",
        params: idParam,
        body: requests.creatorLicenceCreateSchema,
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).licences.create(req.params.id, req.body);
    },
  );

  r.patch(
    '/licences/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Update a creator licence (a renewal: new number or expiry date)',
        params: idParam,
        body: requests.creatorLicenceUpdateSchema,
      },
    },
    async (req) => servicesFor(req).licences.update(req.params.id, req.body),
  );

  r.delete(
    '/licences/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Influencers'], summary: 'Remove a creator licence', params: idParam },
    },
    async (req, reply) => {
      await servicesFor(req).licences.remove(req.params.id);
      reply.status(204).send();
    },
  );

  r.get(
    '/campaigns/:id/licences',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: "Each creator on the roster against the campaign's countries that need a licence",
        params: idParam,
      },
    },
    async (req) => servicesFor(req).licences.forCampaign(req.params.id),
  );

  r.get(
    '/compliance/settings',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Platform'],
        summary: 'Countries where creators need an advertising licence',
      },
    },
    async (req) => servicesFor(req).licences.settings(),
  );

  r.put(
    '/compliance/settings',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Platform'],
        summary: 'Admin: set the countries where creators need an advertising licence',
        body: requests.complianceSettingsUpdateSchema,
      },
    },
    async (req) => servicesFor(req).licences.updateSettings(req.body),
  );
}
