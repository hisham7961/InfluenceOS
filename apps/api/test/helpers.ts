import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Build a real app instance backed by the (test) database. */
export async function makeApp(): Promise<FastifyInstance> {
  return buildApp();
}

/**
 * Provision a throwaway ADMIN and return an authenticated session. Every test
 * gets a unique email so suites are self-contained and non-destructive against
 * the shared dev/CI database.
 */
export async function loginFresh(
  app: FastifyInstance,
): Promise<{ tokens: Tokens; email: string; password: string; userId: string; auth: Record<string, string> }> {
  const email = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';

  // Bootstrap an admin directly so the suite doesn't depend on seed data.
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({
    data: { email, name: 'Test Admin', role: 'ADMIN', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();

  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const tokens = (res.json() as { tokens: Tokens }).tokens;
  return { tokens, email, password, userId: user.id, auth: { authorization: `Bearer ${tokens.accessToken}` } };
}

/** Delete a user and its cascade (sessions, etc.) after a test. */
export async function deleteUser(userId: string): Promise<void> {
  const { PrismaClient } = await import('@influenceos/database');
  const prisma = new PrismaClient();
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
}

/**
 * The typed API client (the same one the web and mobile apps use) talking to
 * the in-process app through `app.inject` — no port, no network (P2.8). Tests
 * read like the apps' own calls and break when a route and its client drift.
 */
export async function clientFor(app: FastifyInstance, headers: Record<string, string>) {
  const { createClient } = await import('@influenceos/api-client');
  const viaInject: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      payload: typeof init?.body === 'string' ? init.body : undefined,
    });
    const outHeaders = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (v != null) outHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    const empty = res.statusCode === 204 || res.statusCode === 304;
    return new Response(empty ? null : res.rawPayload, { status: res.statusCode, headers: outHeaders });
  };
  return createClient({ baseUrl: 'http://api.test', fetch: viaInject, headers, credentials: 'omit' });
}
