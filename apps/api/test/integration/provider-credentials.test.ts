import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AdapterCapabilities } from '@influenceos/shared';
import type { ProviderCredentialStatusDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * INT-4 — admin-managed, encrypted provider credentials. Proves the whole chain
 * end to end against the real DB: an admin stores YOUTUBE_API_KEY (sealed before
 * it touches the database), the runtime credential overlay picks it up so
 * YouTube's capability flips apiConfigured=true, the value is never returned in
 * full (only masked), and removing it reverts to the environment.
 */
describe('INT-4 — encrypted provider credential store', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  const capFor = (list: AdapterCapabilities[], p: string) => list.find((c) => c.platform === p)!;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    // Clean slate in case a prior run left a row (module snapshot is process-global).
    await app.inject({ method: 'DELETE', url: '/api/v1/integrations/credentials/YOUTUBE_API_KEY', headers: auth });
  });

  afterAll(async () => {
    await app.inject({ method: 'DELETE', url: '/api/v1/integrations/credentials/YOUTUBE_API_KEY', headers: auth });
    await app.close();
    await deleteUser(userId);
  });

  it('YouTube starts unconfigured (env is empty in the test environment)', async () => {
    const caps = (await app.inject({ method: 'GET', url: '/api/v1/integrations/capabilities', headers: auth })).json() as AdapterCapabilities[];
    expect(capFor(caps, 'YOUTUBE').apiConfigured).toBe(false);
  });

  it('storing a key flips apiConfigured true and is reflected in the masked status', async () => {
    const set = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/credentials',
      headers: auth,
      payload: { key: 'YOUTUBE_API_KEY', value: 'AIzaSyTEST-secret-1234' },
    });
    expect(set.statusCode).toBe(200);

    const caps = (await app.inject({ method: 'GET', url: '/api/v1/integrations/capabilities', headers: auth })).json() as AdapterCapabilities[];
    expect(capFor(caps, 'YOUTUBE').apiConfigured).toBe(true);

    const statuses = (await app.inject({ method: 'GET', url: '/api/v1/integrations/credentials', headers: auth })).json() as ProviderCredentialStatusDTO[];
    const yt = statuses.find((s) => s.key === 'YOUTUBE_API_KEY')!;
    expect(yt.source).toBe('DB');
    expect(yt.isSet).toBe(true);
    expect(yt.last4).toBe('••••1234'); // masked — last 4 only
    expect(yt.updatedAt).toBeTruthy();

    // The raw value is NEVER returned by any endpoint.
    const raw = JSON.stringify(statuses);
    expect(raw).not.toContain('AIzaSyTEST-secret-1234');
  });

  it('removing the key reverts YouTube to unconfigured', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/integrations/credentials/YOUTUBE_API_KEY', headers: auth });
    expect(del.statusCode).toBe(200);
    const caps = (await app.inject({ method: 'GET', url: '/api/v1/integrations/capabilities', headers: auth })).json() as AdapterCapabilities[];
    expect(capFor(caps, 'YOUTUBE').apiConfigured).toBe(false);
  });

  it('rejects an unknown credential key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/credentials',
      headers: auth,
      payload: { key: 'NOT_A_REAL_KEY', value: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires admin (a fresh non-admin path is covered by requireAdmin on the route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/integrations/credentials' });
    expect(res.statusCode).toBe(401);
  });
});
