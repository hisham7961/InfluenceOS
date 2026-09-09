import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Keep in sync with packages/shared/src/providers/embeds.ts IFRAME_ALLOWED_ORIGINS.
const FRAME_SRC = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://www.instagram.com',
  'https://www.tiktok.com',
  'https://platform.twitter.com',
].join(' ');

const isProd = process.env.NODE_ENV === 'production';

// The browser uploads (presigned PUT) and downloads (presigned GET) directly to
// the object store, so its public origin must be allowed by connect-src/img-src.
// In real production this is an https host (already covered by `https:`), but
// making it explicit also permits a non-https store (e.g. a MinIO endpoint on a
// private network, or http://localhost:9000 in CI/dev). Derived from the
// server-side S3_PUBLIC_ENDPOINT so no browser secret is involved.
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
const s3Origin = originOf(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || '');
const s3Src = s3Origin ? ` ${s3Origin}` : '';

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `img-src 'self' data: blob: https:${s3Src}`,
  `media-src 'self' https:${s3Src}`,
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Next.js requires 'unsafe-inline'/'unsafe-eval' for its runtime; dev also
  // needs eval for fast refresh. Production keeps unsafe-inline for Next's
  // inline bootstrap but drops the dev-only websocket/localhost connect sources.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  isProd
    ? `connect-src 'self' https:${s3Src}`
    : `connect-src 'self' https: http://localhost:4000 ws: wss:${s3Src}`,
  `frame-src ${FRAME_SRC}`,
  "frame-ancestors 'self'",
].join('; ');

// HSTS is only meaningful (and only safe) over HTTPS, so it is production-only.
// The TLS-terminating reverse proxy also sets it; this is defence in depth.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@influenceos/api-client', '@influenceos/contracts', '@influenceos/shared'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
