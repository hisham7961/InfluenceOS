/**
 * Auth transport constant names — the single source of truth for the cookie
 * names and lifetimes used by the web BFF and the API's cookie fallback.
 *
 * These are SAFE constants only: names and durations, never secrets and never
 * server-only logic, so every layer can import them without drift — the web's
 * server components AND its edge middleware (which cannot import a `server-only`
 * module), and the API. Renaming a cookie here is a deliberate, single-place
 * change; the transport test pins these values so an accidental edit is caught.
 */

/** httpOnly cookies the WEB BFF sets on its own origin to hold the API tokens.
 *  The browser script never reads them; the API never receives them (the BFF
 *  forwards the access token as an `Authorization: Bearer` header instead). */
export const WEB_ACCESS_COOKIE = 'io_at';
export const WEB_REFRESH_COOKIE = 'io_rt';
export const WEB_BRAND_COOKIE = 'io_brand';

/** Non-secret per-viewer UI preference cookies (theme/locale). */
export const WEB_LOCALE_COOKIE = 'locale';
export const WEB_THEME_COOKIE = 'theme';

/** Lifetimes (seconds) for the web BFF token cookies. Access is short and is
 *  refreshed by the middleware from the longer-lived refresh cookie. */
export const WEB_ACCESS_MAX_AGE = 60 * 15; // 15 minutes
export const WEB_REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Optional direct-cookie fallback the API reads when a request carries no
 *  `Authorization: Bearer <token>`; bearer is always the primary transport. */
export const API_ACCESS_COOKIE = 'access_token';
export const API_REFRESH_COOKIE = 'refresh_token';

/** The header carrying the bearer token across the BFF → API hop. */
export const AUTH_HEADER = 'authorization';
