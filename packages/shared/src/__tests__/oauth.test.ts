import { describe, expect, it } from 'vitest';
import {
  exchangeInstagramCode,
  exchangeTikTokCode,
  fetchInstagramMediaMetrics,
  fetchTikTokVideoMetrics,
  instagramAuthorizeUrl,
  tiktokAuthorizeUrl,
} from '../providers/oauth';

/** Minimal Response-like object for the fields the helpers read. */
function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
function mockFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as unknown as typeof fetch;
}

describe('Instagram OAuth helpers', () => {
  it('builds an authorize URL with the app id, redirect, state and scopes', () => {
    const url = new URL(
      instagramAuthorizeUrl({ appId: 'app123', redirectUri: 'https://x.io/cb', state: 'st', scopes: ['instagram_basic'] }),
    );
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('app123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.io/cb');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_basic');
  });

  it('exchanges a code for an access token', async () => {
    const f = mockFetch((url) => {
      expect(url).toContain('graph.facebook.com');
      expect(url).toContain('oauth/access_token');
      return res(200, { access_token: 'TOK', expires_in: 5184000 });
    });
    const t = await exchangeInstagramCode(f, { appId: 'a', appSecret: 's', redirectUri: 'r', code: 'c' });
    expect(t.accessToken).toBe('TOK');
    expect(t.expiresInSec).toBe(5184000);
  });

  it('throws when the token response has no access_token', async () => {
    const f = mockFetch(() => res(200, { error: 'nope' }));
    await expect(exchangeInstagramCode(f, { appId: 'a', appSecret: 's', redirectUri: 'r', code: 'c' })).rejects.toThrow();
  });

  it('parses media insights (likes/comments/impressions/saved/reach)', async () => {
    const f = mockFetch(() =>
      res(200, {
        data: [
          { name: 'likes', values: [{ value: 12 }] },
          { name: 'comments', values: [{ value: 3 }] },
          { name: 'impressions', values: [{ value: 900 }] },
          { name: 'saved', values: [{ value: 7 }] },
          { name: 'reach', values: [{ value: 800 }] },
        ],
      }),
    );
    const m = await fetchInstagramMediaMetrics(f, { mediaId: 'm1', accessToken: 'tok' });
    expect(m).toMatchObject({ likes: 12, comments: 3, views: 900, saves: 7, reach: 800 });
  });
});

describe('TikTok OAuth helpers', () => {
  it('builds an authorize URL with PKCE S256 challenge', () => {
    const url = new URL(
      tiktokAuthorizeUrl({ clientKey: 'ck', redirectUri: 'https://x.io/cb', state: 'st', codeChallenge: 'chal' }),
    );
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(url.searchParams.get('client_key')).toBe('ck');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges a code (+ verifier) for tokens', async () => {
    const f = mockFetch((url, init) => {
      expect(url).toContain('open.tiktokapis.com/v2/oauth/token');
      expect(init?.method).toBe('POST');
      expect(String(init?.body)).toContain('code_verifier=ver');
      return res(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 86400, scope: 'user.info.basic', open_id: 'oid' });
    });
    const t = await exchangeTikTokCode(f, { clientKey: 'ck', clientSecret: 'cs', redirectUri: 'r', code: 'c', codeVerifier: 'ver' });
    expect(t).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', externalUserId: 'oid', scope: 'user.info.basic' });
  });

  it('parses video metrics keyed by id', async () => {
    const f = mockFetch((url, init) => {
      expect(url).toContain('open.tiktokapis.com/v2/video/query');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer AT');
      return res(200, { data: { videos: [{ id: 'v1', like_count: 9, comment_count: 2, share_count: 4, view_count: 1000 }] } });
    });
    const m = await fetchTikTokVideoMetrics(f, { accessToken: 'AT', videoIds: ['v1'] });
    expect(m.v1).toMatchObject({ likes: 9, comments: 2, shares: 4, views: 1000 });
  });
});
