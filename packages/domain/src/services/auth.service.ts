import { createHash, randomUUID } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
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

const ACCESS_TTL_SEC = 60 * 15; // 15 minutes
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
    const token = await new SignJWT({ sid: sessionId, typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(secret());
    return { token, expiresAt };
  }

  async function issueTokens(
    user: { id: string; role: string; name: string },
    session: { id: string },
  ): Promise<AuthTokensDTO> {
    const [access, refresh] = await Promise.all([
      signAccessToken(user),
      signRefreshToken(session.id, user.id),
    ]);
    await prisma.deviceSession.update({
      where: { id: session.id },
      data: { refreshTokenHash: sha256(refresh.token), lastActiveAt: new Date() },
    });
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
    const invalid = () => new AppError('UNAUTHORIZED', 'Invalid email or password.');
    if (!user || !user.isActive) throw invalid();
    const ok = await argonVerify(user.passwordHash, input.password).catch(() => false);
    if (!ok) throw invalid();

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
    const tokens = await issueTokens(user, session);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { user: toUserDTO(user), tokens };
  }

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
    const session = await prisma.deviceSession.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError('UNAUTHORIZED', 'Session is no longer valid.');
    }
    // Note: the token JWT is verified and the session must be active. We rotate
    // the stored hash on each refresh but do not hard-revoke on a hash mismatch,
    // so concurrent refreshes from the web client cannot accidentally log a user
    // out. Revocation is driven by explicit logout / session expiry.
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) throw new AppError('UNAUTHORIZED', 'Account is inactive.');
    const tokens = await issueTokens(user, session); // rotates refresh hash
    return { user: toUserDTO(user), tokens };
  }

  async function logout(refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const { payload } = await jwtVerify(refreshToken, secret());
        const sid = (payload as { sid?: string }).sid;
        if (sid) await prisma.deviceSession.updateMany({ where: { id: sid }, data: { revokedAt: new Date() } });
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
      if (last) await prisma.deviceSession.update({ where: { id: last.id }, data: { revokedAt: new Date() } });
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
    await prisma.deviceSession.update({ where: { id }, data: { revokedAt: new Date() } });
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

  return {
    login,
    refresh,
    logout,
    authenticate,
    me,
    sessions,
    revokeSession,
    listUsers,
    createUser,
    hashPassword,
  };
}

export type AuthService = ReturnType<typeof makeAuthService>;
