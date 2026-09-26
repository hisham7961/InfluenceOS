import { z } from 'zod';

/**
 * API environment contract. `loadEnv()` validates the process environment once
 * at startup and, when it is invalid, prints a clear report and exits non-zero
 * (fail-fast — a misconfigured production container must not serve traffic).
 * Production adds stricter checks than development.
 */
const schema = z
  .object({
    NODE_ENV: z.string().default('development'),
    // Deployment environment label (development | staging | production).
    APP_ENV: z.string().optional(),

    // Networking
    API_PORT: z.coerce.number().default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    WORKER_PORT: z.coerce.number().default(4100),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
    INTERNAL_API_URL: z.string().optional(),

    // Data stores
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),

    // Auth
    AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
    AUTH_SESSION_TTL: z.coerce.number().int().positive().optional(),
    AUTH_REFRESH_GRACE_MS: z.coerce.number().int().nonnegative().optional(),
    // Login brute-force lockout (W4-3): consecutive failures before a short
    // account lockout, and how long that lockout lasts. Validated at boot so a
    // typo can't silently disable the protection.
    // Key for stored secrets (provider API keys, creators' OAuth tokens).
    // Optional — without it they are sealed with a key derived from
    // AUTH_SECRET. See packages/domain/src/lib/crypto.ts and `pnpm --filter
    // @influenceos/api run reseal`.
    ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters').optional(),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().max(1000).default(10),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().max(1440).default(15),

    // Object storage
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_INTERNAL_ENDPOINT: z.string().optional(),
    S3_PUBLIC_ENDPOINT: z.string().optional(),
    S3_ENDPOINT: z.string().optional(), // legacy fallback for both of the above
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.string().optional(),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().max(2048).optional(),

    // Rate limiting (configurable; Redis store opt-in for multi-instance)
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),
    RATE_LIMIT_REDIS: z.string().optional(),

    // Interactive API docs (/api/docs) and the raw OpenAPI document
    // (/api/openapi.json). On by default in development, off in production —
    // they map every endpoint for anyone who finds them. API_DOCS=on turns
    // them on anywhere.
    API_DOCS: z.enum(['on', 'off']).optional(),

    // Email (P2.6, optional): the morning summary and alerts people choose to
    // get by email. Without SMTP_URL nothing is emailed. The worker sends;
    // the API only uses it for "Send a test email".
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    APP_URL: z.string().optional(),

    // AI assistance (P3.2, optional): normally set in Settings → AI, which
    // takes precedence. These only fill in what Settings leaves empty; AI
    // stays off until an admin switches it on there.
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),

    // Release metadata (surfaced on /health and Platform status; never secrets)
    APP_VERSION: z.string().optional(),
    GIT_SHA: z.string().optional(),
    BUILD_TIME: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const isProd = env.NODE_ENV === 'production';

    if (isProd) {
      // A production secret must be strong and not the shipped placeholder.
      if (env.AUTH_SECRET.length < 32 || /change-me/i.test(env.AUTH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_SECRET'],
          message: 'In production, AUTH_SECRET must be a strong, non-default value of at least 32 characters.',
        });
      }
    }

    if (env.SMTP_URL && !/^smtps?:\/\/[^\s]+$/i.test(env.SMTP_URL.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_URL'],
        message: 'SMTP_URL must look like smtps://user:password@smtp.example.com:465 or smtp://user:password@host:587.',
      });
    }

    // If S3 storage is selected, its connection details must be present.
    if (env.STORAGE_DRIVER === 's3') {
      const endpoint = env.S3_INTERNAL_ENDPOINT ?? env.S3_ENDPOINT;
      if (!endpoint) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_INTERNAL_ENDPOINT'],
          message: 'STORAGE_DRIVER=s3 requires S3_INTERNAL_ENDPOINT (or legacy S3_ENDPOINT).',
        });
      }
      if (!env.S3_BUCKET) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['S3_BUCKET'], message: 'STORAGE_DRIVER=s3 requires S3_BUCKET.' });
      }
      if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ACCESS_KEY_ID'],
          message: 'STORAGE_DRIVER=s3 requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.',
        });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  // Compose passes optional settings through as `${VAR:-}`, so an unset one
  // arrives as an empty string: treat that as not set.
  const input = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid API environment configuration:\n${issues}`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the cached env (tests only). */
export function resetEnv(): void {
  cached = null;
}

/** Whether /api/docs and /api/openapi.json are served (see API_DOCS). */
export function apiDocsEnabled(env: Env): boolean {
  return env.API_DOCS ? env.API_DOCS === 'on' : env.NODE_ENV !== 'production';
}

export function corsOrigins(env: Env): string[] {
  return env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
}
