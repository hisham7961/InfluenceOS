import { describe, expect, it } from 'vitest';
import {
  API_ACCESS_COOKIE,
  API_REFRESH_COOKIE,
  AUTH_HEADER,
  WEB_ACCESS_COOKIE,
  WEB_ACCESS_MAX_AGE,
  WEB_BRAND_COOKIE,
  WEB_LOCALE_COOKIE,
  WEB_REFRESH_COOKIE,
  WEB_REFRESH_MAX_AGE,
  WEB_THEME_COOKIE,
} from '@influenceos/contracts';

/**
 * Transport-constant contract (freeze pass item 3). The cookie names and
 * lifetimes now live once in @influenceos/contracts and are imported by the web
 * BFF, the edge middleware, and the API. Pinning them here means any rename is a
 * deliberate, single-place change — an accidental edit fails CI instead of
 * silently breaking sessions across the tiers.
 */
describe('shared auth transport constants', () => {
  it('pins the web BFF cookie names', () => {
    expect(WEB_ACCESS_COOKIE).toBe('io_at');
    expect(WEB_REFRESH_COOKIE).toBe('io_rt');
    expect(WEB_BRAND_COOKIE).toBe('io_brand');
    expect(WEB_LOCALE_COOKIE).toBe('locale');
    expect(WEB_THEME_COOKIE).toBe('theme');
  });

  it('pins the API cookie-fallback names and the auth header', () => {
    expect(API_ACCESS_COOKIE).toBe('access_token');
    expect(API_REFRESH_COOKIE).toBe('refresh_token');
    expect(AUTH_HEADER).toBe('authorization');
  });

  it('keeps a short access lifetime and a longer refresh lifetime', () => {
    expect(WEB_ACCESS_MAX_AGE).toBe(60 * 15);
    expect(WEB_REFRESH_MAX_AGE).toBe(60 * 60 * 24 * 7);
    expect(WEB_ACCESS_MAX_AGE).toBeLessThan(WEB_REFRESH_MAX_AGE);
  });

  it('never collides web and API cookie names (distinct transport layers)', () => {
    const web = [WEB_ACCESS_COOKIE, WEB_REFRESH_COOKIE];
    const api = [API_ACCESS_COOKIE, API_REFRESH_COOKIE];
    expect(web.some((n) => api.includes(n))).toBe(false);
  });
});
