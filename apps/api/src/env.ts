import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  // Comma-separated list of allowed web origins for CORS.
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid API environment configuration:\n${issues}`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export function corsOrigins(env: Env): string[] {
  return env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
}
