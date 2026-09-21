import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DuplicateCandidateDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Final Completion Pass — live pre-creation duplicate check
 * (POST /data-quality/duplicates/check). Wired into the Add Influencer flow
 * as an advisory-only check run against a single candidate BEFORE it is
 * created, using the exact same normalization/confidence/reasons rules as
 * data-quality.service.ts's bulk duplicates() scan — just narrowed to one
 * candidate instead of clustering the whole table. Deliberately NOT
 * brand-scoped: a duplicate check must see across every brand.
 */
describe('Duplicate check — POST /data-quality/duplicates/check', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(userId);
  });

  it('finds an exact match on a shared email', async () => {
    const email = `dupcheck-${Date.now()}@example.com`;
    const existingId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `Existing Email Match ${Date.now()}`, email, countryCode: 'KW' },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/duplicates/check',
      headers: auth,
      payload: { displayName: 'Totally Different Name', email },
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    const match = candidates.find((c) => c.influencerId === existingId);
    expect(match).toBeDefined();
    expect(match!.confidence).toBe('exact');
    expect(match!.reasons.some((r) => r.field === 'email' && r.value === email)).toBe(true);
  });

  it('finds a strongPossible match on a matching multi-word display name (no hard identifier shared)', async () => {
    const name = `Jane Anne Doeling ${Date.now()}`;
    const existingId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: name, countryCode: 'KW' },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/duplicates/check',
      headers: auth,
      payload: { displayName: name },
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    const match = candidates.find((c) => c.influencerId === existingId);
    expect(match).toBeDefined();
    expect(match!.confidence).toBe('strongPossible');
    expect(match!.reasons.some((r) => r.field === 'name' && r.value === name)).toBe(true);
  });

  it('finds a possible match on a matching single-word display name', async () => {
    const name = `Zaidcheck${Date.now()}`;
    const existingId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: name, countryCode: 'KW' },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/duplicates/check',
      headers: auth,
      payload: { displayName: name },
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    const match = candidates.find((c) => c.influencerId === existingId);
    expect(match).toBeDefined();
    expect(match!.confidence).toBe('possible');
  });

  it('excludeInfluencerId excludes the influencer being edited from its own duplicate check', async () => {
    const email = `dupcheck-exclude-${Date.now()}@example.com`;
    const existingId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `Exclude Self ${Date.now()}`, email, countryCode: 'KW' },
      }),
    );

    // Without excludeInfluencerId, checking the same email surfaces itself.
    const withoutExclude = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/duplicates/check',
      headers: auth,
      payload: { email },
    });
    const withoutExcludeIds = (withoutExclude.json() as DuplicateCandidateDTO[]).map((c) => c.influencerId);
    expect(withoutExcludeIds).toContain(existingId);

    // With excludeInfluencerId set to itself (editing its own profile), it
    // must never appear as a "duplicate" of itself.
    const withExclude = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/duplicates/check',
      headers: auth,
      payload: { email, excludeInfluencerId: existingId },
    });
    expect(withExclude.statusCode).toBe(200);
    const withExcludeIds = (withExclude.json() as DuplicateCandidateDTO[]).map((c) => c.influencerId);
    expect(withExcludeIds).not.toContain(existingId);
  });

  it('returns no candidates when nothing shares any identifying field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/duplicates/check',
      headers: auth,
      payload: {
        displayName: `Nobody Matches This Unique Name ${Date.now()}`,
        email: `nobody-${Date.now()}@example.com`,
        mobile: `+9655${Date.now()}`.slice(0, 14),
      },
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    expect(candidates).toHaveLength(0);
  });
});
