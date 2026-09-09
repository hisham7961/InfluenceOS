import { describe, expect, it } from 'vitest';
import { buildEmbed, isAllowedIframeOrigin, IFRAME_ALLOWED_ORIGINS } from '../providers/embeds';

describe('buildEmbed', () => {
  it('builds a privacy-enhanced YouTube iframe on an allowlisted origin', () => {
    const e = buildEmbed('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(e?.kind).toBe('iframe');
    expect(e?.iframeSrc).toContain('youtube-nocookie.com/embed/aqz-KE-bpKQ');
    expect(isAllowedIframeOrigin(e!.iframeSrc!)).toBe(true);
  });

  it('builds the official tweet iframe for X', () => {
    const e = buildEmbed('https://x.com/jack/status/20');
    expect(e?.kind).toBe('iframe');
    expect(e?.iframeSrc).toContain('platform.twitter.com/embed/Tweet.html?id=20');
  });

  it('builds a TikTok embed only for numeric video ids', () => {
    const ok = buildEmbed('https://www.tiktok.com/@t/video/7106594312292453675');
    expect(ok?.kind).toBe('iframe');
    expect(ok?.iframeSrc).toContain('tiktok.com/embed/v2/');
  });

  it('falls back to link-only for Snapchat', () => {
    const e = buildEmbed('https://www.snapchat.com/add/creator');
    expect(e?.kind).toBe('link-only');
  });

  it('only allowlists the five official embed origins', () => {
    expect(isAllowedIframeOrigin('https://evil.example.com/embed')).toBe(false);
    expect(IFRAME_ALLOWED_ORIGINS.length).toBe(5);
  });
});
