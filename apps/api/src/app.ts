import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
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
import { AppError, maxUploadBytes } from '@influenceos/domain';
import { API_PREFIX, type ApiErrorBody, type ApiErrorCode } from '@influenceos/contracts';
import { corsOrigins, loadEnv } from './env';
import { resolveActor } from './http';
import { registerRoutes } from './routes/index';
import { installCaching } from './cache';
import { checkDatabase } from './health';
import { releaseInfo } from './release';
import { recordHttp, renderMetrics } from './metrics';

/** Build the optional Redis store for distributed rate limiting. Only used when
 *  RATE_LIMIT_REDIS is truthy and REDIS_URL is set (multi-instance deploys);
 *  otherwise limits are per-instance in memory. */
async function buildRateLimitRedis(url: string) {
  const { default: IORedis } = await import('ioredis');
  return new IORedis(url, { connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false });
}

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'warn'),
      // Never let secrets reach the logs (defense-in-depth; bodies aren't logged).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.headers["x-api-key"]',
        ],
        censor: '[redacted]',
      },
    },
    // Structured request/response logging is emitted by our own onResponse hook
    // (so we can attach actorId); disable Fastify's default req/res lines.
    disableRequestLogging: true,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? `req_${randomUUID()}`,
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

  const redisStore =
    env.RATE_LIMIT_REDIS && env.RATE_LIMIT_REDIS !== 'false' && env.REDIS_URL
      ? await buildRateLimitRedis(env.REDIS_URL).catch(() => undefined)
      : undefined;
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Liveness/readiness/metrics probes must never be rate-limited.
    allowList: (req) => req.url === '/health' || req.url === '/ready' || req.url === '/metrics',
    ...(redisStore ? { redis: redisStore, skipOnError: true } : {}),
  });
  // Raw binary body for the file blob-upload proxy (two-phase signed uploads).
  // Bounded to the max upload size; JSON is still parsed by the default parser.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: maxUploadBytes() },
    (_req, body, done) => done(null, body),
  );
  // ETag + conditional-request (304) support, plus per-route Cache-Control.
  await app.register(etag, { weak: true });
  installCaching(app);

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

  // Expose the request id on every response so it can be correlated with logs
  // (and with the `requestId` returned in error bodies) across the proxy chain.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Structured access log with the resolved actor attached. One line per
  // request; secrets are already redacted by the logger config above. Also feed
  // the metrics counter using the matched route template (low cardinality),
  // never the raw URL.
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? 'unmatched';
    recordHttp(request.method, route, reply.statusCode);
    request.log.info(
      {
        reqId: request.id,
        method: request.method,
        url: request.url,
        route,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
        actorId: request.actor?.id ?? null,
      },
      'request completed',
    );
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

    const { statusCode, message } = error as { statusCode?: number; message?: string };
    const safeMessage = message ?? 'Request failed.';
    if (statusCode === 401) return reply.status(401).send(errBody('UNAUTHORIZED', safeMessage, requestId));
    if (statusCode === 403) return reply.status(403).send(errBody('FORBIDDEN', safeMessage, requestId));
    if (statusCode === 429) {
      return reply.status(429).send(errBody('RATE_LIMITED', 'Too many requests. Please slow down.', requestId));
    }
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send(errBody('BAD_REQUEST', safeMessage, requestId));
    }

    request.log.error({ err: error, requestId }, 'Unhandled error');
    return reply.status(500).send(errBody('INTERNAL', 'Something went wrong. Please try again.', requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errBody('NOT_FOUND', `No route for ${request.method} ${request.url}`, request.id));
  });

  // Liveness: the process is up and can serve. Cheap, no dependency I/O — a
  // load balancer / orchestrator uses this to decide whether to restart the
  // container. Also surfaces the running build so operators can confirm the
  // deployed SHA. Never returns secrets.
  app.get('/health', { schema: { hide: true } }, async () => ({
    status: 'ok',
    ...releaseInfo(),
    uptimeSec: Math.round(process.uptime()),
  }));

  // Readiness: the process can reach its critical dependencies (the database).
  // Returns 503 when a dependency is down so a rolling deploy / proxy keeps
  // traffic off an instance that would only error. Not rate-limited.
  app.get('/ready', { schema: { hide: true } }, async (_req, reply) => {
    const checks = [await checkDatabase()];
    const ready = checks.every((c) => c.status === 'ok');
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks,
    });
  });

  // Prometheus metrics. MUST stay internal — the reverse proxy only exposes
  // /api/v1, /api/docs and /api/openapi.json publicly, so /metrics is reachable
  // only on the private network where the scraper lives. No secrets, low
  // cardinality (route templates + status classes only).
  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    const db = await checkDatabase();
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderMetrics(db.status === 'ok');
  });

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
