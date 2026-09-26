import { describe, expect, it } from 'vitest';
import { InstagramAdapter } from '../providers/adapters/instagram';
import { XAdapter } from '../providers/adapters/x';
import { YouTubeAdapter } from '../providers/adapters/youtube';
import { TikTokAdapter } from '../providers/adapters/tiktok';
import { SnapchatAdapter } from '../providers/adapters/snapchat';
import type { AdapterContext } from '../providers/types';

/**
 * Mocked-fetch unit tests for the social provider adapters. No network and no
 * real API keys are used: the injectable `fetchFn` returns canned responses, so
 * these tests exercise the exact parsing + credential-gating + error-mapping
 * logic that runs in production against YouTube/X/Instagram. This is the safety
 * net that catches a provider changing a response field, without needing keys.
 */

/** A minimal Response-like object for the fields the adapters actually read. */
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Build an AdapterContext whose fetch is driven by a url→response handler. */
function ctxWith(
  credentials: Record<string, string | undefined>,
  handler: (url: string, init?: RequestInit) => Response,
): AdapterContext {
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;
  return { credentials, fetchFn };
}

const NEVER = () => {
  throw new Error('fetch should not be called');
};

describe('YouTubeAdapter', () => {
  const input = { platform: 'YOUTUBE' as const, username: 'mkbhd', profileUrl: 'https://youtube.com/@mkbhd' };

  it('is manual (NO_CREDENTIAL) and never calls the network without an API key', async () => {
    const yt = new YouTubeAdapter(ctxWith({}, NEVER));
    expect(yt.apiConfigured).toBe(false);
    const r = await yt.resolveProfile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_CREDENTIAL');
  });

  it('resolves a channel via the Data API and parses statistics', async () => {
    const yt = new YouTubeAdapter(
      ctxWith({ YOUTUBE_API_KEY: 'k' }, (url) => {
        expect(url).toContain('googleapis.com/youtube/v3/channels');
        return res(200, {
          items: [
            {
              id: 'UC123',
              snippet: { title: 'MKBHD', description: 'tech', thumbnails: { high: { url: 'http://a/high.jpg' } } },
              statistics: { subscriberCount: '18000000', videoCount: '1600' },
            },
          ],
        });
      }),
    );
    expect(yt.apiConfigured).toBe(true);
    const r = await yt.resolveProfile(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('OFFICIAL_API');
      expect(r.data.displayName).toBe('MKBHD');
      expect(r.data.followers).toBe(18000000);
      expect(r.data.postCount).toBe(1600);
      expect(r.data.platformUserId).toBe('UC123');
    }
  });

  it('parses video statistics (views/likes/comments)', async () => {
    const yt = new YouTubeAdapter(
      ctxWith({ YOUTUBE_API_KEY: 'k' }, (url) => {
        expect(url).toContain('/videos?part=statistics');
        return res(200, { items: [{ statistics: { viewCount: '1000', likeCount: '80', commentCount: '12' } }] });
      }),
    );
    const r = await yt.syncContentMetrics({ externalId: 'abc123' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.views).toBe(1000);
      expect(r.data.likes).toBe(80);
      expect(r.data.comments).toBe(12);
    }
  });

  it('maps a 403 (quota) to a retryable RATE_LIMITED fallback', async () => {
    const yt = new YouTubeAdapter(ctxWith({ YOUTUBE_API_KEY: 'k' }, () => res(403, {})));
    const r = await yt.syncContentMetrics({ externalId: 'abc123' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('RATE_LIMITED');
      expect(r.retryable).toBe(true);
    }
  });

  it('capabilities flip apiConfigured with the key', () => {
    expect(new YouTubeAdapter(ctxWith({}, NEVER)).getCapabilities().apiConfigured).toBe(false);
    expect(new YouTubeAdapter(ctxWith({ YOUTUBE_API_KEY: 'k' }, NEVER)).getCapabilities().apiConfigured).toBe(true);
  });
});

describe('XAdapter', () => {
  const input = { platform: 'X' as const, username: 'jack', profileUrl: 'https://x.com/jack' };

  it('is manual without a bearer token', async () => {
    const x = new XAdapter(ctxWith({}, NEVER));
    expect(x.apiConfigured).toBe(false);
    const r = await x.resolveProfile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_CREDENTIAL');
  });

  it('resolves a profile and parses public_metrics', async () => {
    const x = new XAdapter(
      ctxWith({ X_API_BEARER_TOKEN: 't' }, (url, init) => {
        expect(url).toContain('api.twitter.com/2/users/by/username/jack');
        expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer t');
        return res(200, {
          data: {
            id: '12',
            name: 'jack',
            description: 'ceo',
            verified: true,
            profile_image_url: 'http://a/x_normal.jpg',
            public_metrics: { followers_count: 500, following_count: 10, tweet_count: 42 },
          },
        });
      }),
    );
    const r = await x.resolveProfile(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.followers).toBe(500);
      expect(r.data.postCount).toBe(42);
      expect(r.data.isVerified).toBe(true);
      expect(r.data.avatarUrl).toBe('http://a/x.jpg'); // _normal stripped
    }
  });

  it('parses tweet metrics (likes/comments/reposts/views)', async () => {
    const x = new XAdapter(
      ctxWith({ X_API_BEARER_TOKEN: 't' }, () =>
        res(200, {
          data: { public_metrics: { like_count: 9, reply_count: 3, retweet_count: 4, quote_count: 1, impression_count: 1000 } },
        }),
      ),
    );
    const r = await x.syncContentMetrics({ externalId: '20' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.likes).toBe(9);
      expect(r.data.comments).toBe(3);
      expect(r.data.reposts).toBe(4);
      expect(r.data.views).toBe(1000);
    }
  });

  it('maps a 429 to RATE_LIMITED', async () => {
    const x = new XAdapter(ctxWith({ X_API_BEARER_TOKEN: 't' }, () => res(429, {})));
    const r = await x.resolveProfile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('RATE_LIMITED');
  });
});

describe('InstagramAdapter', () => {
  const input = { platform: 'INSTAGRAM' as const, username: 'natgeo', profileUrl: 'https://instagram.com/natgeo' };

  it('requires app authorization when Meta credentials are absent (no network)', async () => {
    const ig = new InstagramAdapter(ctxWith({}, NEVER));
    expect(ig.apiConfigured).toBe(false);
    const r = await ig.resolveProfile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('REQUIRES_APP_AUTHORIZATION');
  });

  it('resolves a Professional account via Business Discovery', async () => {
    const ig = new InstagramAdapter(
      ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'me' }, (url) => {
        expect(url).toContain('graph.facebook.com');
        expect(url).toContain('business_discovery.username');
        return res(200, {
          business_discovery: {
            id: '999',
            username: 'natgeo',
            name: 'National Geographic',
            biography: 'bio',
            followers_count: 280000000,
            follows_count: 140,
            media_count: 30000,
            profile_picture_url: 'http://a/pic.jpg',
          },
        });
      }),
    );
    expect(ig.apiConfigured).toBe(true);
    const r = await ig.resolveProfile(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.followers).toBe(280000000);
      expect(r.data.displayName).toBe('National Geographic');
      expect(r.data.platformUserId).toBe('999');
    }
  });

  it('maps a 400 to ACCOUNT_NOT_ELIGIBLE (personal / non-discoverable)', async () => {
    const ig = new InstagramAdapter(
      ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'me' }, () => res(400, { error: {} })),
    );
    const r = await ig.resolveProfile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ACCOUNT_NOT_ELIGIBLE');
  });

  it('syncs follower counts for an existing account via Business Discovery', async () => {
    const ig = new InstagramAdapter(
      ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'me' }, (url) => {
        expect(url).toContain('business_discovery.username(natgeo)');
        return res(200, { business_discovery: { username: 'natgeo', followers_count: 281, follows_count: 3, media_count: 9 } });
      }),
    );
    const r = await ig.syncProfile({ username: 'natgeo' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.followers).toBe(281);
      expect(r.data.following).toBe(3);
      expect(r.data.postCount).toBe(9);
    }
  });

  it('keeps follower sync manual without Meta credentials', async () => {
    const r = await new InstagramAdapter(ctxWith({}, NEVER)).syncProfile({ username: 'natgeo' });
    expect(r.ok).toBe(false);
  });

  describe('post metrics via the Business Discovery media edge', () => {
    const CREDS = { INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'me' };
    const media = (items: unknown[]) => ({ business_discovery: { media: { data: items } } });
    const post = (shortcode: string, like_count: number, comments_count: number) => ({
      id: `m_${shortcode}`,
      permalink: `https://www.instagram.com/p/${shortcode}/`,
      like_count,
      comments_count,
      media_type: 'IMAGE',
    });

    it('returns likes + comments for a matching recent post', async () => {
      const ig = new InstagramAdapter(
        ctxWith(CREDS, (url) => {
          expect(url).toContain('business_discovery.username(natgeo)');
          expect(url).toContain('like_count');
          expect(url).toContain('view_count');
          return res(200, media([post('OTHER', 1, 1), post('ABC123', 4200, 87)]));
        }),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'ABC123',
        originalUrl: 'https://www.instagram.com/p/ABC123/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.likes).toBe(4200);
        expect(r.data.comments).toBe(87);
      }
    });

    it('returns view_count for a reel (Business Discovery exposes it)', async () => {
      const ig = new InstagramAdapter(
        ctxWith(CREDS, () =>
          res(200, media([{ ...post('R9', 300, 12), view_count: 91000 }])),
        ),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'R9',
        originalUrl: 'https://www.instagram.com/reel/R9/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.views).toBe(91000);
    });

    it('leaves views null rather than zero when the field is absent', async () => {
      const ig = new InstagramAdapter(
        ctxWith(CREDS, () => res(200, media([post('IMG1', 5, 1)]))),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'IMG1',
        originalUrl: 'https://www.instagram.com/p/IMG1/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.views).toBeNull();
    });

    it('leaves likes null when the owner hides like counts', async () => {
      // Meta omits like_count under field expansion rather than erroring.
      const ig = new InstagramAdapter(
        ctxWith(CREDS, () =>
          res(200, media([{ id: 'm', permalink: 'https://www.instagram.com/p/HID/', comments_count: 9 }])),
        ),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'HID',
        originalUrl: 'https://www.instagram.com/p/HID/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.likes).toBeNull();
        expect(r.data.comments).toBe(9);
      }
    });

    it('matches a reel permalink for the same shortcode', async () => {
      const ig = new InstagramAdapter(
        ctxWith(CREDS, () =>
          res(200, media([{ ...post('R1', 10, 2), permalink: 'https://www.instagram.com/reel/R1/' }])),
        ),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'R1',
        originalUrl: 'https://www.instagram.com/reel/R1/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.likes).toBe(10);
    });

    it('does not let a shortcode match a longer one that starts with it', async () => {
      const ig = new InstagramAdapter(
        ctxWith(CREDS, () => res(200, media([post('ABC123XY', 999, 999)]))),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'ABC123',
        originalUrl: 'https://www.instagram.com/p/ABC123/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('NOT_FOUND');
    });

    it('reports NOT_FOUND when the post is outside the recent-media window', async () => {
      const ig = new InstagramAdapter(
        ctxWith(CREDS, () => res(200, media([post('NEWER', 5, 5)]))),
      );
      const r = await ig.syncContentMetrics({
        externalId: 'OLDPOST',
        originalUrl: 'https://www.instagram.com/p/OLDPOST/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('NOT_FOUND');
    });

    it('stays manual without the owning handle (an IG post URL has no username)', async () => {
      const ig = new InstagramAdapter(ctxWith(CREDS, NEVER));
      const r = await ig.syncContentMetrics({
        externalId: 'ABC123',
        originalUrl: 'https://www.instagram.com/p/ABC123/',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('INVALID_INPUT');
    });

    it('stays manual when no credentials are configured', async () => {
      const ig = new InstagramAdapter(ctxWith({}, NEVER));
      const r = await ig.syncContentMetrics({
        externalId: 'ABC123',
        originalUrl: 'https://www.instagram.com/p/ABC123/',
        ownerUsername: 'natgeo',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('REQUIRES_APP_AUTHORIZATION');
    });

    it('maps a 400 to ACCOUNT_NOT_ELIGIBLE (personal / non-discoverable owner)', async () => {
      const ig = new InstagramAdapter(ctxWith(CREDS, () => res(400, { error: {} })));
      const r = await ig.syncContentMetrics({
        externalId: 'ABC123',
        originalUrl: 'https://www.instagram.com/p/ABC123/',
        ownerUsername: 'someone',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('ACCOUNT_NOT_ELIGIBLE');
    });
  });
});

describe('TikTokAdapter (embed + availability only)', () => {
  it('never advertises an active API', () => {
    expect(new TikTokAdapter(ctxWith({ TIKTOK_CLIENT_KEY: 'k' }, NEVER)).apiConfigured).toBe(false);
  });

  it('reports LIVE via public oEmbed', async () => {
    const tt = new TikTokAdapter(ctxWith({}, (url) => {
      expect(url).toContain('tiktok.com/oembed');
      return res(200, { title: 'ok' });
    }));
    const a = await tt.checkContentAvailability({ originalUrl: 'https://www.tiktok.com/@u/video/1' });
    expect(a.status).toBe('LIVE');
    expect(a.checkedVia).toBe('OEMBED');
  });

  it('reports REMOVED on a 404 oEmbed', async () => {
    const tt = new TikTokAdapter(ctxWith({}, () => res(404, {})));
    const a = await tt.checkContentAvailability({ originalUrl: 'https://www.tiktok.com/@u/video/1' });
    expect(a.status).toBe('REMOVED');
  });
});

describe('SnapchatAdapter (manual)', () => {
  it('is manual for profile resolution', async () => {
    const sc = new SnapchatAdapter(ctxWith({}, NEVER));
    expect(sc.apiConfigured).toBe(false);
    const r = await sc.resolveProfile({ platform: 'SNAPCHAT', username: 'team', profileUrl: 'https://snapchat.com/add/team' });
    expect(r.ok).toBe(false);
  });
});

describe('testConnection (P2.4 — Admin → Integrations "Test")', () => {
  it('reports "no credential" without calling the provider', async () => {
    for (const a of [new YouTubeAdapter(ctxWith({}, NEVER)), new XAdapter(ctxWith({}, NEVER)), new InstagramAdapter(ctxWith({}, NEVER))]) {
      const r = await a.testConnection();
      expect(r).toMatchObject({ ok: false, live: false });
    }
  });

  it('YouTube: a keyed call that returns items is a pass; a 400 key error is a clear fail', async () => {
    const good = new YouTubeAdapter(
      ctxWith({ YOUTUBE_API_KEY: 'k' }, (url) => {
        expect(url).toContain('/i18nLanguages?');
        return res(200, { items: [] });
      }),
    );
    expect(await good.testConnection()).toMatchObject({ ok: true, live: true, httpStatus: 200 });

    const bad = new YouTubeAdapter(ctxWith({ YOUTUBE_API_KEY: 'k' }, () => res(400, { error: { message: 'API key not valid.' } })));
    const r = await bad.testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('API key not valid.');
  });

  it('Instagram: reads our own business account; a refused token is reported without echoing it', async () => {
    const good = new InstagramAdapter(
      ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: '178' }, (url) => {
        expect(url).toContain('/178?fields=id,username');
        return res(200, { id: '178', username: 'agency' });
      }),
    );
    expect(await good.testConnection()).toMatchObject({ ok: true, live: true });

    const bad = new InstagramAdapter(
      ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'secret-token', INSTAGRAM_BUSINESS_ACCOUNT_ID: '178' }, () =>
        res(401, { error: { message: 'Invalid OAuth access token. access_token=secret-token' } }),
      ),
    );
    const r = await bad.testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/refused the credential/);
    expect(r.message).not.toContain('secret-token');
  });

  it('X: bearer token accepted → pass; rate limit → fail with a plain reason', async () => {
    const good = new XAdapter(
      ctxWith({ X_API_BEARER_TOKEN: 'b' }, (_url, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer b');
        return res(200, { data: { id: '783214', username: 'X' } });
      }),
    );
    expect(await good.testConnection()).toMatchObject({ ok: true });
    const limited = new XAdapter(ctxWith({ X_API_BEARER_TOKEN: 'b' }, () => res(429, { title: 'Too Many Requests' })));
    expect((await limited.testConnection()).message).toMatch(/Rate limited/);
  });

  it('a network failure is a fail, never a throw', async () => {
    const down = new YouTubeAdapter(
      ctxWith({ YOUTUBE_API_KEY: 'k' }, () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await down.testConnection()).toMatchObject({ ok: false, live: true, message: 'Could not reach the provider.' });
  });

  it('platforms without an API we call say so instead of claiming a connection', async () => {
    const r = await new SnapchatAdapter(ctxWith({}, NEVER)).testConnection();
    expect(r.live).toBe(false);
  });
});

describe('listRecentPosts (P3.4 post discovery)', () => {
  it("lists an Instagram Professional account's newest posts via Business Discovery", async () => {
    const ig = new InstagramAdapter(
      ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'me' }, (url) => {
        expect(url).toContain('business_discovery.username(sara.kw)');
        expect(url).toContain('caption');
        return res(200, {
          business_discovery: {
            media: {
              data: [
                { id: '1', permalink: 'https://www.instagram.com/reel/Cabc123/', media_type: 'VIDEO', timestamp: '2026-09-20T10:00:00+0000', caption: 'Glow #ad @brand' },
                { id: '2', permalink: 'https://www.instagram.com/p/Cdef456/', media_type: 'IMAGE', timestamp: '2026-09-18T08:00:00+0000' },
                { id: '3', media_type: 'IMAGE' },
              ],
            },
          },
        });
      }),
    );
    const r = await ig.listRecentPosts({ username: 'sara.kw' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual([
        { externalId: 'Cabc123', url: 'https://www.instagram.com/reel/Cabc123/', postedAt: '2026-09-20T10:00:00.000Z', caption: 'Glow #ad @brand', mediaType: 'VIDEO' },
        { externalId: 'Cdef456', url: 'https://www.instagram.com/p/Cdef456/', postedAt: '2026-09-18T08:00:00.000Z', caption: null, mediaType: 'IMAGE' },
      ]);
    }
  });

  it('Instagram: personal accounts are not eligible; no credentials means no network', async () => {
    const personal = new InstagramAdapter(ctxWith({ INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'me' }, () => res(400, {})));
    const r = await personal.listRecentPosts({ username: 'someone' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ACCOUNT_NOT_ELIGIBLE');
    const off = await new InstagramAdapter(ctxWith({}, NEVER)).listRecentPosts({ username: 'x' });
    expect(off.ok).toBe(false);
  });

  it("lists a YouTube channel's uploads from its uploads playlist (UC… → UU…)", async () => {
    const yt = new YouTubeAdapter(
      ctxWith({ YOUTUBE_API_KEY: 'k' }, (url) => {
        expect(url).toContain('/playlistItems');
        expect(url).toContain('playlistId=UUabc');
        return res(200, {
          items: [
            { snippet: { title: 'Review', description: 'Code SARA15' }, contentDetails: { videoId: 'vid1', videoPublishedAt: '2026-09-21T12:00:00Z' } },
            { snippet: { title: 'No id' }, contentDetails: {} },
          ],
        });
      }),
    );
    const r = await yt.listRecentPosts({ username: 'sara', platformUserId: 'UCabc' });
    expect(r.ok && r.data).toEqual([
      { externalId: 'vid1', url: 'https://www.youtube.com/watch?v=vid1', postedAt: '2026-09-21T12:00:00.000Z', caption: 'Review\nCode SARA15', mediaType: 'VIDEO' },
    ]);
  });

  it('YouTube: finds the uploads playlist by handle; quota errors are retryable', async () => {
    const calls: string[] = [];
    const yt = new YouTubeAdapter(
      ctxWith({ YOUTUBE_API_KEY: 'k' }, (url) => {
        calls.push(url);
        if (url.includes('/channels')) return res(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUxyz' } } }] });
        return res(200, { items: [] });
      }),
    );
    const r = await yt.listRecentPosts({ username: 'sara' });
    expect(r.ok && r.data).toEqual([]);
    expect(calls[1]).toContain('playlistId=UUxyz');
    const quota = new YouTubeAdapter(ctxWith({ YOUTUBE_API_KEY: 'k' }, () => res(403, {})));
    const q = await quota.listRecentPosts({ username: 'sara', platformUserId: 'UCabc' });
    expect(!q.ok && q.retryable).toBe(true);
  });

  it("lists an X account's own posts; a tier without timelines stays manual", async () => {
    const x = new XAdapter(
      ctxWith({ X_API_BEARER_TOKEN: 'b' }, (url) => {
        expect(url).toContain('/users/42/tweets');
        return res(200, { data: [{ id: '777', text: 'Loving it #ad', created_at: '2026-09-22T09:00:00.000Z' }] });
      }),
    );
    const r = await x.listRecentPosts({ username: '@sara', platformUserId: '42' });
    expect(r.ok && r.data).toEqual([
      { externalId: '777', url: 'https://x.com/sara/status/777', postedAt: '2026-09-22T09:00:00.000Z', caption: 'Loving it #ad', mediaType: 'POST' },
    ]);
    const basic = new XAdapter(ctxWith({ X_API_BEARER_TOKEN: 'b' }, () => res(403, {})));
    const b = await basic.listRecentPosts({ username: 'sara', platformUserId: '42' });
    expect(!b.ok && b.reason).toBe('REQUIRES_APP_AUTHORIZATION');
  });

  it('TikTok and Snapchat cannot list posts (manual)', async () => {
    for (const a of [new TikTokAdapter(ctxWith({}, NEVER)), new SnapchatAdapter(ctxWith({}, NEVER))]) {
      const r = await a.listRecentPosts({ username: 'sara' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fallback).toBe('MANUAL');
    }
  });
});
