import { describe, expect, it } from 'vitest';
import { coverUrl, fetchCover, isAllowedCoverUrl, sniffImage, verifyCoverLink } from '../covers';

process.env.AUTH_SECRET ??= 'test-secret-at-least-16-chars';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function respond(
  status: number,
  body: Buffer | null,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

describe('cover hosts', () => {
  it('allows only https links on the platforms’ image hosts', () => {
    expect(isAllowedCoverUrl('https://scontent-fra3-1.cdninstagram.com/v/t51/abc.jpg?stp=x')).toBe(
      true,
    );
    expect(isAllowedCoverUrl('https://p16-sign-va.tiktokcdn.com/obj/cover.jpeg')).toBe(true);
    expect(isAllowedCoverUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(true);
    expect(isAllowedCoverUrl('http://scontent.cdninstagram.com/a.jpg')).toBe(false);
    expect(isAllowedCoverUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedCoverUrl('https://evilcdninstagram.com/a.jpg')).toBe(false);
    expect(isAllowedCoverUrl('https://cdninstagram.com.evil.io/a.jpg')).toBe(false);
    expect(isAllowedCoverUrl('https://user:pw@scontent.cdninstagram.com/a.jpg')).toBe(false);
    expect(isAllowedCoverUrl('https://scontent.cdninstagram.com:8443/a.jpg')).toBe(false);
    expect(isAllowedCoverUrl('not a url')).toBe(false);
  });
});

describe('sniffImage', () => {
  it('recognises images by their bytes, not their name', () => {
    expect(sniffImage(JPEG)?.mime).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('<html>hi</html>'))).toBeNull();
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
  });
});

describe('fetchCover', () => {
  it('downloads an image from an allowed host', async () => {
    const got = await fetchCover('https://i.ytimg.com/vi/x/hq.jpg', async () => respond(200, JPEG));
    expect(got.ok && got.type.ext).toBe('jpg');
  });

  it('refuses a redirect to a host that is not allowed', async () => {
    const calls: string[] = [];
    const got = await fetchCover('https://i.ytimg.com/vi/x/hq.jpg', async (url) => {
      calls.push(String(url));
      return respond(302, null, { location: 'http://127.0.0.1:4000/metrics' });
    });
    expect(got).toEqual({ ok: false, reason: 'blocked' });
    expect(calls).toHaveLength(1);
  });

  it('refuses something that is not an image, or too big', async () => {
    expect(
      await fetchCover('https://i.ytimg.com/a.jpg', async () =>
        respond(200, Buffer.from('<html>')),
      ),
    ).toEqual({
      ok: false,
      reason: 'blocked',
    });
    expect(
      await fetchCover('https://i.ytimg.com/a.jpg', async () =>
        respond(200, JPEG, { 'content-length': String(10 * 1024 * 1024) }),
      ),
    ).toEqual({ ok: false, reason: 'blocked' });
  });

  it('reports an expired link as gone', async () => {
    expect(await fetchCover('https://i.ytimg.com/a.jpg', async () => respond(403, null))).toEqual({
      ok: false,
      reason: 'gone',
    });
  });
});

describe('cover links', () => {
  it('are the same all day and work for at least a day', () => {
    const morning = Date.UTC(2026, 8, 26, 1, 0);
    const evening = Date.UTC(2026, 8, 26, 23, 0);
    expect(coverUrl('abc', morning)).toBe(coverUrl('abc', evening));
    const q = new URL(coverUrl('abc', evening), 'http://x').searchParams;
    expect(verifyCoverLink('abc', q.get('e')!, q.get('s')!, evening + 24 * 3600 * 1000)).toBe(true);
  });

  it('refuse a changed id, a changed expiry or an expired link', () => {
    const now = Date.UTC(2026, 8, 26, 12, 0);
    const q = new URL(coverUrl('abc', now), 'http://x').searchParams;
    const e = q.get('e')!;
    const s = q.get('s')!;
    expect(verifyCoverLink('abc', e, s, now)).toBe(true);
    expect(verifyCoverLink('abd', e, s, now)).toBe(false);
    expect(verifyCoverLink('abc', String(Number(e) + 86400), s, now)).toBe(false);
    expect(verifyCoverLink('abc', e, s, (Number(e) + 1) * 1000)).toBe(false);
    expect(verifyCoverLink('abc', undefined, s, now)).toBe(false);
  });
});
