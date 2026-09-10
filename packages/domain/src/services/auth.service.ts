import { createHash, randomUUID } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { SignJWT, decodeJwt, jwtVerify } from 'jose';
import {
  requests,
  type AuthResultDTO,
  type AuthTokensDTO,
  type DeviceSessionDTO,
  type UserDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { ClientType, User } from '@influenceos/database';
import type { Actor, DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAdmin } from '../lib/authz';
import { open, seal } from '../lib/crypto';

const ACCESS_TTL_SEC = 60 * 15; // 15 minutes
/** Consecutive failed logins before a short account lockout kicks in. */
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 10;
/** Lockout window (minutes) after the attempt threshold is crossed. */
const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES) || 15;
/** Grace window during which a just-rotated refresh token is still accepted,
 *  so genuinely concurrent refreshes from one client don't trip reuse
 *  detection. Configurable for tests via AUTH_REFRESH_GRACE_MS. */
const REFRESH_GRACE_MS = Number(process.env.AUTH_REFRESH_GRACE_MS) || 30_000;
function refreshTtlSec(): number {
  const v = Number(process.env.AUTH_SESSION_TTL);
  return Number.isFinite(v) && v > 0 ? v : 60 * 60 * 24 * 7;
}
function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new AppError('INTERNAL', 'AUTH_SECRET is not configured.');
  }
  return new TextEncoder().encode(s);
}
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

type LoginInput = z.infer<typeof requests.loginSchema>;
type RegisterInput = z.infer<typeof requests.registerUserSchema>;

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

function toUserDTO(u: Pick<User, 'id' | 'email' | 'name' | 'role' | 'avatarUrl' | 'locale' | 'theme'>): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    avatarUrl: u.avatarUrl,
    locale: u.locale,
    theme: u.theme,
  };
}

export function makeAuthService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function hashPassword(password: string): Promise<string> {
    return argonHash(password);
  }

  async function signAccessToken(user: { id: string; role: string; name: string }): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ACCESS_TTL_SEC * 1000);
    const token = await new SignJWT({ role: user.role, name: user.name, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(secret());
    return { token, expiresAt };
  }

  async function signRefreshToken(sessionId: string, userId: string): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + refreshTtlSec() * 1000);
    // A unique jti guarantees every rotated token is a distinct string (and
    // hash), even when two are minted within the same second — essential for
    // single-use rotation and reuse detection.
    const token = await new SignJWT({ sid: sessionId, typ: 'refresh', jti: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(secret());
    return { token, expiresAt };
  }

  /** Mint an access+refresh pair. Pure — performs NO database writes, so it is
   *  safe to call inside a transaction before the atomic lineage update. */
  async function mintPair(
    user: { id: string; role: string; name: string },
    sessionId: string,
  ): Promise<AuthTokensDTO> {
    const [access, refresh] = await Promise.all([
      signAccessToken(user),
      signRefreshToken(sessionId, user.id),
    ]);
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      tokenType: 'Bearer',
    };
  }

  async function login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResultDTO> {
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    // Uniform error so login never reveals whether an account exists.
    const invalid = () => new AppError('UNAUTHORIZED', 'Invalid email or password.');
    if (!user || !user.isActive) throw invalid();

    // Account-level, time-boxed lockout — a second line of defence against a
    // distributed brute force that spreads across IPs to dodge the per-IP route
    // limit. The window is short so it can't be weaponised to lock a real user
    // out for long. See LOGIN_MAX_ATTEMPTS / LOGIN_LOCK_MINUTES.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError('UNAUTHORIZED', 'Too many failed attempts. Please try again shortly.');
    }

    const ok = await argonVerify(user.passwordHash, input.password).catch(() => false);
    if (!ok) {
      const attempts = user.failedLoginAttempts + 1;
      const lock = attempts >= LOGIN_MAX_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      throw invalid();
    }

    const client = (input.device?.client ?? 'WEB') as ClientType;
    const session = await prisma.deviceSession.create({
      data: {
        userId: user.id,
        client,
        deviceId: input.device?.deviceId ?? null,
        deviceName: input.device?.deviceName ?? null,
        appVersion: input.device?.appVersion ?? null,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        refreshTokenHash: 'pending',
        expiresAt: new Date(Date.now() + refreshTtlSec() * 1000),
      },
    });
    const tokens = await mintPair(user, session.id);
    // The login token is NOT sealed into grace storage — only rotations need
    // that — so a fresh login never persists a live token in plaintext form.
    await prisma.deviceSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256(tokens.refreshToken),
        prevRefreshTokenHash: null,
        refreshRotatedAt: new Date(),
        graceTokenSealed: null,
        lastActiveAt: new Date(),
      },
    });
    // Success clears any accumulated failure state.
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
    return { user: toUserDTO(user), tokens };
  }

  /**
   * Rotate a refresh token — atomically and concurrency-safe (addendum
   * §mobile-safe auth). The whole read-decide-rotate sequence runs inside a
   * transaction that holds a `SELECT … FOR UPDATE` row lock on the session, so
   * two concurrent refreshes cannot interleave and clobber each other's
   * lineage.
   *
   * Three outcomes, evaluated under the lock:
   *  (a) the presented token is the live one → rotate: mint a new pair, seal
   *      the new token into grace storage, advance the lineage.
   *  (b) the presented token is the one just consumed, replayed inside the
   *      grace window (a genuinely concurrent refresh) → return the SAME token
   *      the winner minted (decrypted from grace storage) plus a fresh access
   *      token. This is idempotent: every concurrent caller converges on ONE
   *      live token, so no legitimately-returned token is ever later flagged
   *      as reuse.
   *  (c) any other correctly-signed token for an active session is a retired
   *      token being replayed → revoke the whole family.
   */
  async function refresh(refreshToken: string): Promise<AuthResultDTO> {
    let payload: { sub?: string; sid?: string; typ?: string };
    try {
      const verified = await jwtVerify(refreshToken, secret());
      payload = verified.payload as typeof payload;
    } catch {
      throw new AppError('UNAUTHORIZED', 'Invalid or expired refresh token.');
    }
    if (payload.typ !== 'refresh' || !payload.sid || !payload.sub) {
      throw new AppError('UNAUTHORIZED', 'Invalid refresh token.');
    }
    const sid = payload.sid;
    const presented = sha256(refreshToken);

    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize concurrent refreshes of this session (Postgres row lock).
      await tx.$queryRaw`SELECT id FROM "DeviceSession" WHERE id = ${sid} FOR UPDATE`;
      const session = await tx.deviceSession.findUnique({ where: { id: sid } });
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new AppError('UNAUTHORIZED', 'Session is no longer valid.');
      }
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (!user || !user.isActive) throw new AppError('UNAUTHORIZED', 'Account is inactive.');

      const withinGrace =
        session.refreshRotatedAt != null &&
        Date.now() - session.refreshRotatedAt.getTime() <= REFRESH_GRACE_MS;

      // (a) Live token → rotate atomically (we hold the row lock).
      if (presented === session.refreshTokenHash) {
        const tokens = await mintPair(user, session.id);
        await tx.deviceSession.update({
          where: { id: session.id },
          data: {
            refreshTokenHash: sha256(tokens.refreshToken),
            prevRefreshTokenHash: presented,
            refreshRotatedAt: new Date(),
            graceTokenSealed: seal(tokens.refreshToken),
            lastActiveAt: new Date(),
          },
        });
        return { kind: 'ok' as const, user, tokens };
      }

      // (b) The just-consumed token, replayed within the grace window →
      //     idempotently return the winner's token (access tokens are
      //     independent of the refresh lineage, so a fresh one is fine).
      if (presented === session.prevRefreshTokenHash && withinGrace && session.graceTokenSealed) {
        const graceRefresh = open(session.graceTokenSealed);
        if (graceRefresh) {
          const access = await signAccessToken(user);
          const exp = (decodeJwt(graceRefresh).exp ?? 0) * 1000;
          return {
            kind: 'ok' as const,
            user,
            tokens: {
              accessToken: access.token,
              refreshToken: graceRefresh,
              accessTokenExpiresAt: access.expiresAt.toISOString(),
              refreshTokenExpiresAt: new Date(exp).toISOString(),
              tokenType: 'Bearer' as const,
            } satisfies AuthTokensDTO,
          };
        }
      }

      // (c) A retired token being replayed → revoke the whole family. We must
      //     COMMIT the revoke, so return a marker and throw AFTER the
      //     transaction rather than throwing here (which would roll it back).
      await tx.deviceSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokedReason: 'refresh_token_reuse_detected',
          graceTokenSealed: null,
        },
      });
      return { kind: 'reuse' as const };
    });

    if (outcome.kind === 'reuse') {
      throw new AppError('UNAUTHORIZED', 'This session was ended for security reasons. Please sign in again.');
    }
    return { user: toUserDTO(outcome.user), tokens: outcome.tokens };
  }

  async function logout(refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const { payload } = await jwtVerify(refreshToken, secret());
        const sid = (payload as { sid?: string }).sid;
        if (sid) await prisma.deviceSession.updateMany({ where: { id: sid }, data: { revokedAt: new Date(), graceTokenSealed: null } });
        return;
      } catch {
        /* fall through */
      }
    }
    if (ctx.actor) {
      // Best-effort: revoke the most recent session for this user.
      const last = await prisma.deviceSession.findFirst({
        where: { userId: ctx.actor.id, revokedAt: null },
        orderBy: { lastActiveAt: 'desc' },
      });
      if (last) await prisma.deviceSession.update({ where: { id: last.id }, data: { revokedAt: new Date(), graceTokenSealed: null } });
    }
  }

  /** Verify an access token → Actor (stateless; used by the API auth guard). */
  async function authenticate(token: string): Promise<Actor | null> {
    try {
      const { payload } = await jwtVerify(token, secret());
      if ((payload as { typ?: string }).typ !== 'access' || !payload.sub) return null;
      return {
        id: payload.sub,
        name: (payload as { name?: string }).name ?? '',
        role: ((payload as { role?: string }).role ?? 'STAFF') as Actor['role'],
      };
    } catch {
      return null;
    }
  }

  async function me(): Promise<UserDTO> {
    if (!ctx.actor) throw AppError.unauthorized();
    const user = await prisma.user.findUnique({ where: { id: ctx.actor.id } });
    if (!user) throw AppError.unauthorized();
    return toUserDTO(user);
  }

  /** Persist the current user's UI preferences (locale/theme) on their account
   *  so they follow the user across devices and to future mobile clients. Only
   *  the provided fields change. */
  async function updatePreferences(
    input: z.infer<typeof requests.updatePreferencesSchema>,
  ): Promise<UserDTO> {
    if (!ctx.actor) throw AppError.unauthorized();
    const user = await prisma.user.update({
      where: { id: ctx.actor.id },
      data: {
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
      },
    });
    return toUserDTO(user);
  }

  async function sessions(): Promise<DeviceSessionDTO[]> {
    if (!ctx.actor) throw AppError.unauthorized();
    const rows = await prisma.deviceSession.findMany({
      where: { userId: ctx.actor.id, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      client: s.client,
      deviceName: s.deviceName,
      appVersion: s.appVersion,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      current: false,
    }));
  }

  async function revokeSession(id: string): Promise<void> {
    if (!ctx.actor) throw AppError.unauthorized();
    const session = await prisma.deviceSession.findUnique({ where: { id } });
    if (!session || session.userId !== ctx.actor.id) throw AppError.notFound('Session');
    await prisma.deviceSession.update({ where: { id }, data: { revokedAt: new Date(), graceTokenSealed: null } });
  }

  // --- User administration (admin only) -----------------------------------
  async function listUsers(): Promise<UserDTO[]> {
    requireAdmin(ctx);
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toUserDTO);
  }

  async function createUser(input: RegisterInput): Promise<UserDTO> {
    requireAdmin(ctx);
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw AppError.conflict('A user with that email already exists.');
    const user = await prisma.user.create({
      data: {
        email,
        name: input.name,
        role: input.role ?? 'STAFF',
        passwordHash: await hashPassword(input.password),
      },
    });
    return toUserDTO(user);
  }

  /**
   * Change the authenticated user's own password. Requires the current
   * password. **Session policy:** on success ALL of the user's sessions are
   * revoked (including the caller's), so any token derived from the old
   * credentials — anywhere — is immediately dead and the user must sign in
   * again everywhere. This makes the bootstrap "change it immediately" step a
   * real, enforced workflow.
   */
  async function changePassword(input: z.infer<typeof requests.changePasswordSchema>): Promise<void> {
    if (!ctx.actor) throw AppError.unauthorized();
    const user = await prisma.user.findUnique({ where: { id: ctx.actor.id } });
    if (!user) throw AppError.unauthorized();
    const ok = await argonVerify(user.passwordHash, input.currentPassword).catch(() => false);
    if (!ok) throw AppError.badRequest('Your current password is incorrect.');
    if (input.newPassword === input.currentPassword) {
      throw AppError.badRequest('Your new password must be different from your current one.');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });
    await prisma.deviceSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_changed', graceTokenSealed: null },
    });
  }

  return {
    login,
    refresh,
    logout,
    authenticate,
    me,
    updatePreferences,
    sessions,
    revokeSession,
    changePassword,
    listUsers,
    createUser,
    hashPassword,
  };
}

export type AuthService = ReturnType<typeof makeAuthService>;
