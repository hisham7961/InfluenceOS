import { describe, expect, it } from 'vitest';
import { contentUrlHandle, detectPlatform, normalizeProfileInput, normalizeContentUrl, parseContentId, stablePostId } from '../providers/url';

describe('detectPlatform', () => {
  it('detects platforms from URLs', () => {
    expect(detectPlatform('https://www.instagram.com/creator')).toBe('INSTAGRAM');
    expect(detectPlatform('https://www.tiktok.com/@creator')).toBe('TIKTOK');
    expect(detectPlatform('https://youtu.be/dQw4w9WgXcQ')).toBe('YOUTUBE');
    expect(detectPlatform('https://x.com/jack')).toBe('X');
    expect(detectPlatform('https://twitter.com/jack')).toBe('X');
    expect(detectPlatform('https://www.snapchat.com/add/creator')).toBe('SNAPCHAT');
    expect(detectPlatform('https://example.com/foo')).toBeNull();
  });
});

describe('normalizeProfileInput', () => {
  it('extracts usernames from profile URLs', () => {
    expect(normalizeProfileInput('https://www.instagram.com/nourhaddad')?.username).toBe('nourhaddad');
    expect(normalizeProfileInput('https://www.tiktok.com/@reemeats')?.username).toBe('reemeats');
    expect(normalizeProfileInput('https://www.youtube.com/@faisaltech')?.username).toBe('faisaltech');
    expect(normalizeProfileInput('https://x.com/khalidr')?.username).toBe('khalidr');
  });

  it('handles a bare handle with a platform hint', () => {
    const r = normalizeProfileInput('@creator', 'INSTAGRAM');
    expect(r?.platform).toBe('INSTAGRAM');
    expect(r?.username).toBe('creator');
    expect(r?.profileUrl).toContain('instagram.com/creator');
  });

  it('returns null for a bare handle without a hint', () => {
    expect(normalizeProfileInput('creator')).toBeNull();
  });
});

describe('parseContentId', () => {
  it('parses content ids per platform', () => {
    expect(parseContentId('https://www.youtube.com/watch?v=aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(parseContentId('https://youtu.be/jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(parseContentId('https://www.youtube.com/shorts/abc123')).toBe('abc123');
    expect(parseContentId('https://x.com/jack/status/20')).toBe('20');
    expect(parseContentId('https://www.instagram.com/p/C1uleWFxYQK/')).toBe('C1uleWFxYQK');
    expect(parseContentId('https://www.tiktok.com/@t/video/7106594312292453675')).toBe('7106594312292453675');
  });
});

describe('normalizeContentUrl', () => {
  it('strips tracking params and returns platform + id', () => {
    const r = normalizeContentUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s&utm_source=x');
    expect(r?.platform).toBe('YOUTUBE');
    expect(r?.externalId).toBe('aqz-KE-bpKQ');
    expect(r?.canonicalUrl).not.toContain('utm_source');
  });
});

describe('contentUrlHandle', () => {
  it('reads the account from links that carry it', () => {
    expect(contentUrlHandle('https://www.tiktok.com/@sara.kw/video/7301234567890123456')).toBe('sara.kw');
    expect(contentUrlHandle('https://www.snapchat.com/@noor_q8/spotlight/W7_abc')).toBe('noor_q8');
    expect(contentUrlHandle('https://x.com/someone/status/1790000000000000000')).toBe('someone');
    expect(contentUrlHandle('https://www.instagram.com/fatma.style/reel/C1abcDEF/')).toBe('fatma.style');
    expect(contentUrlHandle('https://www.instagram.com/stories/fatma.style/3301234567890/')).toBe('fatma.style');
  });

  it('returns null when the link does not name the account', () => {
    expect(contentUrlHandle('https://www.instagram.com/reel/C1abcDEF/')).toBeNull();
    expect(contentUrlHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(contentUrlHandle('https://www.snapchat.com/spotlight/W7_abc')).toBeNull();
    expect(contentUrlHandle('https://x.com/i/status/1790000000000000000')).toBeNull();
    expect(contentUrlHandle('https://example.com/@sara')).toBeNull();
    expect(contentUrlHandle('https://www.tiktok.com/@%E0%A4%A/video/1')).toBeNull();
  });
});

describe('stablePostId', () => {
  it('keeps ids that name one post and drops ones that do not', () => {
    expect(stablePostId('TIKTOK', '7301234567890123456')).toBe('7301234567890123456');
    expect(stablePostId('TIKTOK', 'v')).toBeNull();
    expect(stablePostId('X', '1790000000000000000')).toBe('1790000000000000000');
    expect(stablePostId('INSTAGRAM', 'C1abcDEF')).toBe('C1abcDEF');
    expect(stablePostId('YOUTUBE', 'dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(stablePostId('SNAPCHAT', 'W7_abcdefgh')).toBeNull();
    expect(stablePostId('INSTAGRAM', null)).toBeNull();
  });
});
