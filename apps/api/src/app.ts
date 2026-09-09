import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { AppError } from '@influenceos/domain';
import { API_PREFIX, type ApiErrorBody, type ApiErrorCode } from '@influenceos/contracts';
import { corsOrigins, loadEnv } from './env';
import { resolveActor } from './http';
import { registerRoutes } from './routes/index';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: corsOrigins(env),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/health',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'InfluenceOS API',
        description:
          'InfluenceOS platform API. The single source of truth consumed by the Web client and future iOS/Android clients. All endpoints are versioned under /api/v1.',
        version: '1.0.0',
      },
      servers: [{ url: env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '') }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication, sessions, current user' },
        { name: 'Brands', description: 'Brand workspaces' },
        { name: 'Influencers', description: 'Influencer directory & 360 profiles' },
        { name: 'Campaigns', description: 'Campaigns, influencers, deliverables' },
        { name: 'Content', description: 'Published content, player, monitoring' },
        { name: 'Dashboard', description: 'Mission Control aggregations' },
        { name: 'Reports', description: 'Analytics & CSV export' },
        { name: 'Calendar', description: 'Campaign & content calendar' },
        { name: 'Notifications', description: 'In-app notifications' },
        { name: 'Activity', description: 'Activity feed' },
        { name: 'Search', description: 'Global search' },
        { name: 'Settings', description: 'Integrations, users, platform & API' },
        { name: 'Platform', description: 'Feature registry, mobile readiness, client config' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // Resolve the authenticated actor for every request (stateless bearer).
  app.addHook('onRequest', async (request) => {
    request.actor = null;
    try {
      request.actor = await resolveActor(request);
    } catch {
      request.actor = null;
    }
  });

  // Standardized error contract (addendum §30) — never leaks DB errors/stacks.
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      return reply.status(error.httpStatus).send(errBody(error.code, error.message, requestId, {
        fieldErrors: error.fieldErrors,
        details: error.details,
      }));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const fieldErrors = error.validation.map((v) => ({
        field: v.params?.issue?.path?.join('.') || v.instancePath?.replace(/^\//, '') || 'body',
        message: v.params?.issue?.message ?? v.message ?? 'Invalid value',
      }));
      return reply.status(422).send(errBody('VALIDATION_ERROR', 'Validation failed.', requestId, { fieldErrors }));
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 401) return reply.status(401).send(errBody('UNAUTHORIZED', error.message, requestId));
    if (statusCode === 403) return reply.status(403).send(errBody('FORBIDDEN', error.message, requestId));
    if (statusCode === 429) {
      return reply.status(429).send(errBody('RATE_LIMITED', 'Too many requests. Please slow down.', requestId));
    }
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send(errBody('BAD_REQUEST', error.message, requestId));
    }

    request.log.error({ err: error, requestId }, 'Unhandled error');
    return reply.status(500).send(errBody('INTERNAL', 'Something went wrong. Please try again.', requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errBody('NOT_FOUND', `No route for ${request.method} ${request.url}`, request.id));
  });

  app.get('/health', async () => ({ status: 'ok', service: 'influenceos-api' }));

  // OpenAPI JSON for SDK generation (addendum §8).
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(async (scoped) => registerRoutes(scoped), { prefix: API_PREFIX });

  return app;
}

function errBody(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  extra: { fieldErrors?: ApiErrorBody['error']['fieldErrors']; details?: unknown } = {},
): ApiErrorBody {
  return { error: { code, message, requestId, ...extra } };
}
