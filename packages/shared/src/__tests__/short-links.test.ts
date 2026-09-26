import { describe, expect, it, vi } from 'vitest';
import { isShortContentLink, resolveShortContentUrl } from '../providers/short-links';

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

describe('isShortContentLink', () => {
  it('spots share-sheet links that hide the post id', () => {
    expect(isShortContentLink('https://vm.tiktok.com/ZMabc123/')).toBe(true);
    expect(isShortContentLink('vt.tiktok.com/ZSxyz/')).toBe(true);
    expect(isShortContentLink('https://www.tiktok.com/t/ZT8abc/')).toBe(true);
    expect(isShortContentLink('https://www.instagram.com/share/reel/BAabc/')).toBe(true);
    expect(isShortContentLink('https://www.tiktok.com/@sara/video/7301234567890123456')).toBe(false);
    expect(isShortContentLink('https://www.instagram.com/reel/C1abc/')).toBe(false);
  });
});

describe('resolveShortContentUrl', () => {
  it('follows a TikTok short link to the canonical video URL', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      redirect('https://www.tiktok.com/@sara/video/7301234567890123456?_r=1&u_code=abc'),
    );
    const url = await resolveShortContentUrl('https://vm.tiktok.com/ZMabc123/', { fetchFn: fetchFn as never });
    expect(url).toBe('https://www.tiktok.com/@sara/video/7301234567890123456');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('follows more than one hop', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://m.tiktok.com/v/7301234567890123456.html'))
      .mockResolvedValueOnce(redirect('https://www.tiktok.com/@sara/video/7301234567890123456'));
    expect(await resolveShortContentUrl('https://www.tiktok.com/t/ZT8abc/', { fetchFn: fetchFn as never })).toBe(
      'https://www.tiktok.com/@sara/video/7301234567890123456',
    );
  });

  it('never follows a redirect off TikTok/Instagram', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data'));
    expect(await resolveShortContentUrl('https://vm.tiktok.com/ZMabc123/', { fetchFn: fetchFn as never })).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary links alone and gives up quietly on errors', async () => {
    const fetchFn = vi.fn();
    expect(await resolveShortContentUrl('https://www.tiktok.com/@sara/video/1', { fetchFn: fetchFn as never })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolveShortContentUrl('https://vm.tiktok.com/ZMabc123/', { fetchFn: failing as never })).toBeNull();
  });
});
