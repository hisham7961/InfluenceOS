import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P0.5 — rate limits used to be keyed by address only, and every browser
 * request reaches the API through the web container, so the whole team shared
 * one budget (and one stranger could block every login). Now: per signed-in
 * user, per real client address otherwise, with a separate per-account login
 * limit.
 */
describe('P0.5 — rate limits per user and per real client address', () => {
  let app: FastifyInstance;
  const saved = process.env.RATE_LIMIT_MAX;
  const cleanup: string[] = [];

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = '5';
    const { resetEnv } = await import('../../src/env.ts');
    resetEnv();
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
    for (const id of cleanup) await deleteUser(id);
    if (saved === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = saved;
    const { resetEnv } = await import('../../src/env.ts');
    resetEnv();
  });

  it('gives each signed-in user their own budget, even from the same address', async () => {
    const a = await loginFresh(app);
    const b = await loginFresh(app);
    cleanup.push(a.userId, b.userId);
    const me = (auth: Record<string, string>) => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });

    for (let i = 0; i < 5; i++) expect((await me(a.auth)).statusCode).toBe(200);
    expect((await me(a.auth)).statusCode).toBe(429);
    // Same address (127.0.0.1), different person: unaffected.
    expect((await me(b.auth)).statusCode).toBe(200);
  });

  it('limits anonymous requests by the forwarded client address', async () => {
    const hit = (ip: string) =>
      app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 5; i++) expect((await hit('198.51.100.7')).statusCode).toBe(401);
    expect((await hit('198.51.100.7')).statusCode).toBe(429);
    expect((await hit('198.51.100.8')).statusCode).toBe(401);
  });

  it('throttles repeated wrong passwords per account and address, not for everyone', async () => {
    const login = (email: string, ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: { email, password: 'wrong-password' },
      });
    const target = `nobody_${Date.now()}@example.test`;
    for (let i = 0; i < 10; i++) expect((await login(target, '192.0.2.50')).statusCode).toBe(401);
    expect((await login(target, '192.0.2.50')).statusCode).toBe(429);
    // Another address, or another account from the same address, still gets through.
    expect((await login(target, '192.0.2.51')).statusCode).toBe(401);
    expect((await login(`other_${target}`, '192.0.2.50')).statusCode).toBe(401);
  });

  it('never counts successful sign-ins against the account (several devices, the E2E suite)', async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `often_${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: { email, name: 'Often', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    cleanup.push(user.id);
    await prisma.$disconnect();
    const login = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': '192.0.2.60' },
        payload: { email, password },
      });
    for (let i = 0; i < 12; i++) expect((await login('Str0ng-Passw0rd!')).statusCode).toBe(200);
    // A few typos in between don't add up across successful sign-ins either.
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) expect((await login('typo')).statusCode).toBe(401);
      expect((await login('Str0ng-Passw0rd!')).statusCode).toBe(200);
    }
  });

  it('records the real client address on the session', async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `ip_${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: { email, name: 'IP Test', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    cleanup.push(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.77', 'user-agent': 'Browser/1.0' },
      payload: { email, password: 'Str0ng-Passw0rd!' },
    });
    expect(res.statusCode).toBe(200);
    const session = await prisma.deviceSession.findFirst({ where: { userId: user.id } });
    expect(session?.ip).toBe('203.0.113.77');
    expect(session?.userAgent).toBe('Browser/1.0');
    await prisma.$disconnect();
  });
});
