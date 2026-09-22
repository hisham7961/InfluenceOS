import { describe, expect, it, vi } from 'vitest';
import { parseOgImage, resolveContentThumbnail, resolveProfileAvatar } from '../providers/thumbnails';

/**
 * Minimal Response stub for the mocked fetch. `url` mirrors what a real
 * `fetch()` Response exposes: the final URL after following any redirect
 * (equal to the request URL when there was none) — needed so
 * `resolveProfileAvatar`'s auth-wall guard (which compares request vs. final
 * URL) sees a normal same-page response by default.
 */
function res(status: number, body: unknown, kind: 'json' | 'text' = 'json', url = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    json: async () => body,
    text: async () => (kind === 'text' ? String(body) : JSON.stringify(body)),
  } as unknown as Response;
}

describe('resolveContentThumbnail (public cover — no credentials)', () => {
  it('derives the YouTube cover from the video id with no network call', async () => {
    const fetchFn = vi.fn();
    const url = await resolveContentThumbnail({
      platform: 'YOUTUBE',
      canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
      externalId: 'abc123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(url).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reads the TikTok cover from the public oEmbed thumbnail_url', async () => {
    const fetchFn = vi.fn(async (u: string) => {
      expect(u).toContain('tiktok.com/oembed');
      return res(200, { thumbnail_url: 'https://p16.tiktokcdn.com/cover.jpg' });
    });
    const url = await resolveContentThumbnail({
      platform: 'TIKTOK',
      canonicalUrl: 'https://www.tiktok.com/@x/video/123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(url).toBe('https://p16.tiktokcdn.com/cover.jpg');
  });

  it('falls back to og:image of the post page (Instagram/X best-effort)', async () => {
    const html = '<html><head><meta property="og:image" content="https://cdn.example.com/pic.jpg" /></head></html>';
    const fetchFn = vi.fn(async () => res(200, html, 'text'));
    const url = await resolveContentThumbnail({
      platform: 'INSTAGRAM',
      canonicalUrl: 'https://www.instagram.com/p/XYZ/',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(url).toBe('https://cdn.example.com/pic.jpg');
  });

  it('returns null when nothing exposes a cover', async () => {
    const fetchFn = vi.fn(async () => res(403, '', 'text'));
    const url = await resolveContentThumbnail({
      platform: 'INSTAGRAM',
      canonicalUrl: 'https://www.instagram.com/p/XYZ/',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(url).toBeNull();
  });

  it('never throws on a network error (guarded)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const url = await resolveContentThumbnail({
      platform: 'TIKTOK',
      canonicalUrl: 'https://www.tiktok.com/@x/video/123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(url).toBeNull();
  });

  it('resolveProfileAvatar reads the profile og:image (the avatar)', async () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/avatar.jpg">';
    const profileUrl = 'https://www.instagram.com/someone/';
    const fetchFn = vi.fn(async () => res(200, html, 'text', profileUrl));
    const url = await resolveProfileAvatar(profileUrl, fetchFn as unknown as typeof fetch);
    expect(url).toBe('https://cdn.example.com/avatar.jpg');
  });

  it('resolveProfileAvatar returns null when the profile is gated / unreachable', async () => {
    const fetchFn = vi.fn(async () => res(403, '', 'text'));
    expect(await resolveProfileAvatar('https://www.instagram.com/x/', fetchFn as unknown as typeof fetch)).toBeNull();
    const throwing = vi.fn(async () => {
      throw new Error('blocked');
    });
    expect(await resolveProfileAvatar('https://www.instagram.com/x/', throwing as unknown as typeof fetch)).toBeNull();
  });

  it('resolveProfileAvatar returns null (not the auth wall\'s own logo) when redirected to a login page', async () => {
    // Instagram's real-world behavior: an unauthenticated/bot-flagged request
    // to a profile page 200s on a login-wall page instead of erroring, and
    // that page has its own generic, platform-branded og:image — trusting it
    // would silently store the wrong "photo" for the creator.
    const html = '<meta property="og:image" content="https://static.cdninstagram.com/rsrc.php/v4/logo.png">';
    const fetchFn = vi.fn(async () =>
      res(200, html, 'text', 'https://www.instagram.com/accounts/login/?next=%2Fsomeone%2F'),
    );
    const url = await resolveProfileAvatar('https://www.instagram.com/someone/', fetchFn as unknown as typeof fetch);
    expect(url).toBeNull();
  });

  it('parseOgImage handles og:image and twitter:image, and decodes &amp;', () => {
    expect(parseOgImage('<meta property="og:image" content="https://a.com/x.jpg?a=1&amp;b=2">')).toBe(
      'https://a.com/x.jpg?a=1&b=2',
    );
    expect(parseOgImage('<meta name="twitter:image" content="https://a.com/t.jpg">')).toBe('https://a.com/t.jpg');
    expect(parseOgImage('<html>no meta</html>')).toBeNull();
  });
});
