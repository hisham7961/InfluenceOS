import { describe, expect, it } from 'vitest';
import { detectPlatform, normalizeProfileInput, normalizeContentUrl, parseContentId } from '../providers/url';

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
