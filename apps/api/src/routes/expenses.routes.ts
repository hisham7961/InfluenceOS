import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.patch(
    '/expenses/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Update a campaign expense',
        params: z.object({ id: z.string() }),
        body: requests.expenseUpdateSchema,
      },
    },
    async (req) => {
      const services = servicesFor(req);
      return services.expenses.update(req.params.id, req.body);
    },
  );

  r.delete(
    '/expenses/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Campaigns'],
        summary: 'Delete a campaign expense',
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      const services = servicesFor(req);
      await services.expenses.remove(req.params.id);
      reply.status(204).send();
    },
  );
}
