import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z } from '@influenceos/contracts';
import { AppError } from '@influenceos/domain';
import { requireAdmin, requireAuth, servicesFor } from '../http';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['Auth'], summary: 'Log in with email and password', body: requests.loginSchema },
    },
    async (req) => {
      const services = servicesFor(req);
      return services.auth.login(req.body, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
    },
  );

  r.post(
    '/auth/refresh',
    { schema: { tags: ['Auth'], summary: 'Exchange a refresh token for new tokens', body: requests.refreshSchema } },
    async (req) => {
      const services = servicesFor(req);
      const token = req.body.refreshToken ?? (req as { cookies?: Record<string, string> }).cookies?.refresh_token;
      if (!token) throw AppError.badRequest('A refresh token is required.');
      return services.auth.refresh(token);
    },
  );

  r.post(
    '/auth/logout',
    { schema: { tags: ['Auth'], summary: 'Revoke the current session', body: z.object({ refreshToken: z.string().optional() }) } },
    async (req, reply) => {
      const services = servicesFor(req);
      await services.auth.logout(req.body.refreshToken);
      reply.status(204).send();
    },
  );

  r.get(
    '/auth/me',
    { preHandler: [requireAuth], schema: { tags: ['Auth'], summary: 'Current authenticated user', security: [{ bearerAuth: [] }] } },
    async (req) => servicesFor(req).auth.me(),
  );

  r.get(
    '/auth/sessions',
    { preHandler: [requireAuth], schema: { tags: ['Auth'], summary: 'List active device sessions' } },
    async (req) => servicesFor(req).auth.sessions(),
  );

  r.delete(
    '/auth/sessions/:id',
    { preHandler: [requireAuth], schema: { tags: ['Auth'], summary: 'Revoke a device session', params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      await servicesFor(req).auth.revokeSession(req.params.id);
      reply.status(204).send();
    },
  );

  // --- User administration ---
  r.get(
    '/users',
    { preHandler: [requireAdmin], schema: { tags: ['Settings'], summary: 'List users (admin)' } },
    async (req) => servicesFor(req).auth.listUsers(),
  );

  r.post(
    '/users',
    { preHandler: [requireAdmin], schema: { tags: ['Settings'], summary: 'Create a user (admin)', body: requests.registerUserSchema } },
    async (req, reply) => {
      const user = await servicesFor(req).auth.createUser(req.body);
      reply.status(201);
      return user;
    },
  );
}
