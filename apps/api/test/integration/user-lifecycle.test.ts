import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { UserDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W4-1 — admin user lifecycle: create, change role, deactivate, reset password,
 * remove. Deactivation/role change take effect on the next request (session
 * binding, W1-3). Self-lockout is refused.
 */
describe('W4-1 — admin user lifecycle', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let targetId: string;
  const email = `lifecycle_${Date.now()}@example.test`;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminAuth = a.auth;
    adminId = a.userId;
    targetId = idOf(await app.inject({
      method: 'POST', url: '/api/v1/users', headers: adminAuth,
      payload: { email, name: 'Target User', password: 'Initial-Pass1', role: 'STAFF' },
    }));
  });

  afterAll(async () => {
    await deleteUser(targetId);
    await deleteUser(adminId);
    await app.close();
  });

  it('exposes isActive on the created user and lists it', async () => {
    const users = (await app.inject({ method: 'GET', url: '/api/v1/users', headers: adminAuth })).json() as UserDTO[];
    const target = users.find((u) => u.id === targetId)!;
    expect(target.isActive).toBe(true);
    expect(target.role).toBe('STAFF');
  });

  it('promotes to ADMIN then deactivates; a deactivated user cannot authenticate', async () => {
    // The target logs in and gets a working token.
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Initial-Pass1' } });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const targetAuth = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: targetAuth })).statusCode).toBe(200);

    const promoted = (await app.inject({ method: 'PATCH', url: `/api/v1/users/${targetId}`, headers: adminAuth, payload: { role: 'ADMIN' } })).json() as UserDTO;
    expect(promoted.role).toBe('ADMIN');

    // Deactivate → the target's existing token stops working on the very next request (W1-3).
    const deactivated = (await app.inject({ method: 'PATCH', url: `/api/v1/users/${targetId}`, headers: adminAuth, payload: { isActive: false } })).json() as UserDTO;
    expect(deactivated.isActive).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: targetAuth })).statusCode).toBe(401);
  });

  it('refuses self-lockout (own role change or self-deactivation)', async () => {
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${adminId}`, headers: adminAuth, payload: { role: 'STAFF' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${adminId}`, headers: adminAuth, payload: { isActive: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/${adminId}`, headers: adminAuth })).statusCode).toBe(400);
  });

  it('resets the target password (old password stops working, new one logs in)', async () => {
    // Reactivate first so login is possible.
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${targetId}`, headers: adminAuth, payload: { isActive: true } });
    const reset = await app.inject({ method: 'POST', url: `/api/v1/users/${targetId}/reset-password`, headers: adminAuth, payload: { newPassword: 'Brand-New-Pass9' } });
    expect(reset.statusCode).toBe(204);

    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Initial-Pass1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Brand-New-Pass9' } })).statusCode).toBe(200);
  });

  it('rejects a weak admin-reset password', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${targetId}/reset-password`, headers: adminAuth, payload: { newPassword: 'weak' } });
    expect(res.statusCode).toBe(422);
  });

  it('removes the user', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/users/${targetId}`, headers: adminAuth });
    expect(del.statusCode).toBe(204);
    const users = (await app.inject({ method: 'GET', url: '/api/v1/users', headers: adminAuth })).json() as UserDTO[];
    expect(users.find((u) => u.id === targetId)).toBeUndefined();
  });
});
