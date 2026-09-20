import { describe, expect, it, vi } from 'vitest';
import { parseOgImage, resolveContentThumbnail } from '../providers/thumbnails';

/** Minimal Response stub for the mocked fetch. */
function res(status: number, body: unknown, kind: 'json' | 'text' = 'json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
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

  it('parseOgImage handles og:image and twitter:image, and decodes &amp;', () => {
    expect(parseOgImage('<meta property="og:image" content="https://a.com/x.jpg?a=1&amp;b=2">')).toBe(
      'https://a.com/x.jpg?a=1&b=2',
    );
    expect(parseOgImage('<meta name="twitter:image" content="https://a.com/t.jpg">')).toBe('https://a.com/t.jpg');
    expect(parseOgImage('<html>no meta</html>')).toBeNull();
  });
});
