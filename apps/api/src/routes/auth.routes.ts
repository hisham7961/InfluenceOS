import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { API_REFRESH_COOKIE, requests, z } from '@influenceos/contracts';
import { AppError } from '@influenceos/domain';
import { requireAdmin, requireAuth, servicesFor } from '../http';
import { fixedWindowLimiter } from '../lib/fixed-window-limiter';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Sign-in attempts are limited twice: per account per address (10 per 15
  // minutes — a stranger hammering the admin's email only slows themselves
  // down, not every login from the office) and per address overall (30 a
  // minute, against trying many accounts from one place).
  const perAddressLogins = fixedWindowLimiter({ max: 30, windowMs: 60_000 });

  r.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
          keyGenerator: (req) => {
            const email = (req.body as { email?: unknown } | undefined)?.email;
            return `login:${req.ip}:${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
          },
        },
      },
      preHandler: [(req) => perAddressLogins(`login-ip:${req.ip}`)],
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
      const token = req.body.refreshToken ?? (req as { cookies?: Record<string, string> }).cookies?.[API_REFRESH_COOKIE];
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

  r.patch(
    '/auth/me/preferences',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Auth'],
        summary: 'Update your UI preferences (locale/theme) on your account',
        body: requests.updatePreferencesSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (req) => servicesFor(req).auth.updatePreferences(req.body),
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

  r.post(
    '/auth/change-password',
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        summary: 'Change your own password (revokes all sessions)',
        body: requests.changePasswordSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      await servicesFor(req).auth.changePassword(req.body);
      reply.status(204).send();
    },
  );

  // --- User administration ---
  r.get(
    '/users',
    { preHandler: [requireAdmin], schema: { tags: ['Settings'], summary: 'List users (admin)' } },
    async (req) => servicesFor(req).auth.listUsers(),
  );

  r.get(
    '/users/directory',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Settings'], summary: 'Lightweight active-user directory for the @mention picker (id/name/avatar only)' },
    },
    async (req) => servicesFor(req).auth.listDirectory(),
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

  const userIdParam = z.object({ id: z.string() });

  r.patch(
    '/users/:id',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: 'Update a user — name / role / active (admin, W4-1)',
        params: userIdParam,
        body: requests.userAdminUpdateSchema,
      },
    },
    async (req) => servicesFor(req).auth.updateUser(req.params.id, req.body),
  );

  r.post(
    '/users/:id/reset-password',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: "Reset a user's password (admin, W4-1)",
        params: userIdParam,
        body: requests.adminResetPasswordSchema,
      },
    },
    async (req, reply) => {
      await servicesFor(req).auth.resetUserPassword(req.params.id, req.body);
      reply.status(204).send();
    },
  );

  r.delete(
    '/users/:id',
    { preHandler: [requireAdmin], schema: { tags: ['Settings'], summary: 'Delete a user (admin, W4-1)', params: userIdParam } },
    async (req, reply) => {
      await servicesFor(req).auth.removeUser(req.params.id);
      reply.status(204).send();
    },
  );

  // --- Per-user brand scope (W4-4) ---
  r.get(
    '/users/:id/brand-access',
    { preHandler: [requireAdmin], schema: { tags: ['Settings'], summary: "List a user's brand scope (admin, W4-4)", params: userIdParam } },
    async (req) => servicesFor(req).auth.getUserBrandAccess(req.params.id),
  );

  r.put(
    '/users/:id/brand-access',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: "Replace a user's brand scope — empty clears it (admin, W4-4)",
        params: userIdParam,
        body: requests.brandAccessSetSchema,
      },
    },
    async (req) => servicesFor(req).auth.setUserBrandAccess(req.params.id, req.body.brandIds),
  );

  // --- Per-user country scope (Advanced Roles pass) — mirrors brand scope ---
  r.get(
    '/users/:id/country-access',
    { preHandler: [requireAdmin], schema: { tags: ['Settings'], summary: "List a user's country scope (admin)", params: userIdParam } },
    async (req) => servicesFor(req).auth.getUserCountryAccess(req.params.id),
  );

  r.put(
    '/users/:id/country-access',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: "Replace a user's country scope — empty clears it (admin)",
        params: userIdParam,
        body: requests.countryAccessSetSchema,
      },
    },
    async (req) => servicesFor(req).auth.setUserCountryAccess(req.params.id, req.body.countryCodes),
  );

  // --- Per-user capability overrides + resolved permission preview (Advanced Roles pass) ---
  r.get(
    '/users/:id/permissions',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: "A user's Role Profile, scope, capability overrides and resolved 'this user can/cannot' preview (admin)",
        params: userIdParam,
      },
    },
    async (req) => servicesFor(req).auth.getUserPermissions(req.params.id),
  );

  r.post(
    '/users/:id/permissions/preview',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: 'Preview the "this user can/cannot" effect of a HYPOTHETICAL, unsaved role/capability edit (admin, never persists)',
        params: userIdParam,
        body: requests.permissionPreviewSchema,
      },
    },
    async (req) => servicesFor(req).auth.previewUserPermissions(req.params.id, req.body),
  );

  r.put(
    '/users/:id/capabilities',
    {
      preHandler: [requireAdmin],
      schema: {
        tags: ['Settings'],
        summary: "Replace a user's explicit capability overrides on top of their Role Profile default (admin)",
        params: userIdParam,
        body: requests.capabilityOverridesSetSchema,
      },
    },
    async (req, reply) => {
      await servicesFor(req).auth.setUserCapabilityOverrides(req.params.id, req.body.overrides);
      reply.status(204).send();
    },
  );
}
