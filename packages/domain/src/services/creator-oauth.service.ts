import { createHash, randomBytes } from 'node:crypto';
import type { CreatorConnectionDTO, CreatorOAuthStartDTO } from '@influenceos/contracts';
import {
  exchangeInstagramCode,
  exchangeTikTokCode,
  instagramAuthorizeUrl,
  tiktokAuthorizeUrl,
  type OAuthTokenResult,
} from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { seal, open } from '../lib/crypto';

/**
 * Creator-OAuth (INT-3): the handshake + encrypted token storage that would let
 * a creator authorize us to read their OWN post metrics. The endpoints exist and
 * are wired end to end, but they are INERT until the platform app passes review
 * (Meta / TikTok) — `start` refuses with a clear message when the app credentials
 * are not configured, which is the default. Only Instagram and TikTok have a
 * creator-OAuth path; other platforms are manual or public-API.
 */

const STATE_TTL_MS = 10 * 60 * 1000;
type CreatorPlatform = 'INSTAGRAM' | 'TIKTOK';

interface StatePayload {
  influencerId: string;
  platform: CreatorPlatform;
  nonce: string;
  verifier?: string;
  ts: number;
}

function callbackUrl(platform: CreatorPlatform): string {
  const base =
    process.env.OAUTH_CALLBACK_BASE_URL?.replace(/\/$/, '') ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    'http://localhost:4000';
  return `${base}/api/v1/integrations/${platform.toLowerCase()}/oauth/callback`;
}

export function makeCreatorOAuthService(ctx: DomainContext) {
  const { prisma, credentials } = ctx;

  function asCreatorPlatform(platform: string): CreatorPlatform {
    if (platform === 'INSTAGRAM' || platform === 'TIKTOK') return platform;
    throw AppError.badRequest(`${platform} has no creator-OAuth flow (manual or public-API only).`);
  }

  /** Build the authorize URL a creator visits to connect. Refuses when the app is not configured. */
  async function start(influencerId: string, platformRaw: string): Promise<CreatorOAuthStartDTO> {
    requireActor(ctx);
    const platform = asCreatorPlatform(platformRaw);
    const influencer = await prisma.influencer.findUnique({ where: { id: influencerId }, select: { id: true } });
    if (!influencer) throw AppError.notFound('Influencer');

    const nonce = randomBytes(16).toString('base64url');
    const redirectUri = callbackUrl(platform);

    if (platform === 'INSTAGRAM') {
      const appId = credentials.INSTAGRAM_APP_ID;
      if (!appId) throw notConfigured('Instagram');
      const state = seal(JSON.stringify({ influencerId, platform, nonce, ts: now() } satisfies StatePayload));
      return { url: instagramAuthorizeUrl({ appId, redirectUri, state }) };
    }

    // TikTok uses PKCE; the verifier is carried (sealed) inside the state.
    const clientKey = credentials.TIKTOK_CLIENT_KEY;
    if (!clientKey) throw notConfigured('TikTok');
    const verifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const state = seal(JSON.stringify({ influencerId, platform, nonce, verifier, ts: now() } satisfies StatePayload));
    return { url: tiktokAuthorizeUrl({ clientKey, redirectUri, state, codeChallenge }) };
  }

  /** Exchange the returned code for a token and store it (sealed). */
  async function callback(code: string, state: string): Promise<CreatorConnectionDTO> {
    const payload = parseState(state);
    const platform = payload.platform;
    const redirectUri = callbackUrl(platform);

    let token: OAuthTokenResult;
    if (platform === 'INSTAGRAM') {
      const appId = credentials.INSTAGRAM_APP_ID;
      const appSecret = credentials.INSTAGRAM_APP_SECRET;
      if (!appId || !appSecret) throw notConfigured('Instagram');
      token = await exchangeInstagramCode(fetch, { appId, appSecret, redirectUri, code });
    } else {
      const clientKey = credentials.TIKTOK_CLIENT_KEY;
      const clientSecret = credentials.TIKTOK_CLIENT_SECRET;
      if (!clientKey || !clientSecret) throw notConfigured('TikTok');
      if (!payload.verifier) throw AppError.badRequest('Missing PKCE verifier in state.');
      token = await exchangeTikTokCode(fetch, {
        clientKey,
        clientSecret,
        redirectUri,
        code,
        codeVerifier: payload.verifier,
      });
    }

    const expiresAt = token.expiresInSec ? new Date(now() + token.expiresInSec * 1000) : null;
    await prisma.creatorOAuthToken.upsert({
      where: { influencerId_platform: { influencerId: payload.influencerId, platform } },
      update: {
        sealedAccessToken: seal(token.accessToken),
        sealedRefreshToken: token.refreshToken ? seal(token.refreshToken) : null,
        externalUserId: token.externalUserId,
        scope: token.scope,
        expiresAt,
      },
      create: {
        influencerId: payload.influencerId,
        platform,
        sealedAccessToken: seal(token.accessToken),
        sealedRefreshToken: token.refreshToken ? seal(token.refreshToken) : null,
        externalUserId: token.externalUserId,
        scope: token.scope,
        expiresAt,
      },
    });

    return { influencerId: payload.influencerId, platform, connected: true, externalUserId: token.externalUserId, scope: token.scope, expiresAt: expiresAt?.toISOString() ?? null };
  }

  /** Which platforms a creator has connected (never returns tokens). */
  async function status(influencerId: string): Promise<CreatorConnectionDTO[]> {
    requireActor(ctx);
    const rows = await prisma.creatorOAuthToken.findMany({
      where: { influencerId },
      select: { platform: true, externalUserId: true, scope: true, expiresAt: true },
    });
    return rows.map((r) => ({
      influencerId,
      platform: r.platform as CreatorPlatform,
      connected: true,
      externalUserId: r.externalUserId,
      scope: r.scope,
      expiresAt: r.expiresAt?.toISOString() ?? null,
    }));
  }

  async function disconnect(influencerId: string, platformRaw: string): Promise<{ ok: true }> {
    requireActor(ctx);
    const platform = asCreatorPlatform(platformRaw);
    await prisma.creatorOAuthToken.deleteMany({ where: { influencerId, platform } });
    return { ok: true };
  }

  /** Decrypt a stored creator access token (server-only; for the metric fetchers). */
  async function accessToken(influencerId: string, platformRaw: string): Promise<string | null> {
    const platform = asCreatorPlatform(platformRaw);
    const row = await prisma.creatorOAuthToken.findUnique({
      where: { influencerId_platform: { influencerId, platform } },
      select: { sealedAccessToken: true },
    });
    return row ? open(row.sealedAccessToken) : null;
  }

  function parseState(state: string): StatePayload {
    const raw = open(state);
    if (!raw) throw AppError.badRequest('Invalid or tampered OAuth state.');
    let payload: StatePayload;
    try {
      payload = JSON.parse(raw) as StatePayload;
    } catch {
      throw AppError.badRequest('Malformed OAuth state.');
    }
    if (!payload.influencerId || (payload.platform !== 'INSTAGRAM' && payload.platform !== 'TIKTOK')) {
      throw AppError.badRequest('Incomplete OAuth state.');
    }
    if (!payload.ts || now() - payload.ts > STATE_TTL_MS) throw AppError.badRequest('Expired OAuth state — start again.');
    return payload;
  }

  return { start, callback, status, disconnect, accessToken };
}

function now(): number {
  return Date.now();
}

function notConfigured(platform: string): AppError {
  return AppError.badRequest(
    `${platform} creator login is not configured. Set the ${platform} app credentials and complete platform app review to enable it.`,
  );
}

export type CreatorOAuthService = ReturnType<typeof makeCreatorOAuthService>;
