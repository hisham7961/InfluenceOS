import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * UI preference persistence (freeze pass item 4). Theme/locale are saved on the
 * user account — not just a device cookie — so the "saved to your account" copy
 * is truthful and a future mobile client shares the same preference.
 */
describe('account UI preferences (locale/theme)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    auth = admin.auth;
    userId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(userId);
  });

  it('defaults to en / system for a new account', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    expect(me.statusCode).toBe(200);
    const user = me.json() as { locale: string; theme: string };
    expect(user.locale).toBe('en');
    expect(user.theme).toBe('system');
  });

  it('persists a locale + theme change and reflects it in /auth/me', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/preferences',
      headers: auth,
      payload: { locale: 'ar', theme: 'dark' },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const updated = patch.json() as { locale: string; theme: string };
    expect(updated.locale).toBe('ar');
    expect(updated.theme).toBe('dark');

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    const user = me.json() as { locale: string; theme: string };
    expect(user.locale).toBe('ar');
    expect(user.theme).toBe('dark');
  });

  it('updates only the fields provided (partial patch)', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/preferences',
      headers: auth,
      payload: { theme: 'light' },
    });
    expect(patch.statusCode).toBe(200);
    const user = patch.json() as { locale: string; theme: string };
    expect(user.locale).toBe('ar'); // unchanged
    expect(user.theme).toBe('light');
  });

  it('rejects an empty patch and invalid values', async () => {
    const empty = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me/preferences', headers: auth, payload: {} });
    expect(empty.statusCode).toBe(422);
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/preferences',
      headers: auth,
      payload: { locale: 'fr' },
    });
    expect(bad.statusCode).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me/preferences', payload: { theme: 'dark' } });
    expect(res.statusCode).toBe(401);
  });
});
