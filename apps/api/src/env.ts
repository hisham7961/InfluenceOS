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
  const parsed = schema.safeParse(process.env);
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

export function corsOrigins(env: Env): string[] {
  return env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
}
