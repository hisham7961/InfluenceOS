import { getAdapter, profileUrl as buildProfileUrl } from '@influenceos/shared';
import { requests, type SocialAccountDTO, type DataSource } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { toSocialAccountDTO } from '../lib/mappers';

type SocialAccountCreate = z.infer<typeof requests.socialAccountCreateSchema>;
type SocialAccountUpdate = z.infer<typeof requests.socialAccountUpdateSchema>;

const accountSelect = {
  id: true,
  influencerId: true,
  platform: true,
  username: true,
  profileUrl: true,
  displayName: true,
  avatarUrl: true,
  followers: true,
  following: true,
  postCount: true,
  isVerified: true,
  isPrimary: true,
  dataSource: true,
  lastSyncedAt: true,
  platformUserId: true,
} as const;

export function makeSocialAccountService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Additive follower snapshot — historical values are never overwritten. */
  async function snapshot(
    socialAccountId: string,
    data: {
      followers?: number | null;
      following?: number | null;
      postCount?: number | null;
      engagementRate?: number | null;
      source: DataSource;
    },
  ) {
    if (data.followers == null && data.following == null && data.postCount == null) return;
    await prisma.socialMetricSnapshot.create({
      data: {
        socialAccountId,
        followers: data.followers ?? null,
        following: data.following ?? null,
        postCount: data.postCount ?? null,
        engagementRate: data.engagementRate ?? null,
        source: data.source,
      },
    });
  }

  async function create(input: SocialAccountCreate): Promise<SocialAccountDTO> {
    requireActor(ctx);
    const influencer = await prisma.influencer.findUnique({ where: { id: input.influencerId } });
    if (!influencer) throw AppError.notFound('Influencer');

    const existing = await prisma.socialAccount.findUnique({
      where: { platform_username: { platform: input.platform, username: input.username } },
    });
    if (existing) {
      throw AppError.conflict(
        `A ${input.platform} account @${input.username} already exists in the system.`,
      );
    }

    const account = await prisma.socialAccount.create({
      data: {
        influencerId: input.influencerId,
        platform: input.platform,
        username: input.username,
        profileUrl: input.profileUrl ?? buildProfileUrl(input.platform, input.username),
        platformUserId: input.platformUserId ?? null,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        bio: input.bio ?? null,
        followers: input.followers ?? null,
        following: input.following ?? null,
        postCount: input.postCount ?? null,
        isVerified: input.isVerified ?? null,
        isPrimary: input.isPrimary ?? false,
        dataSource: input.followers != null ? 'MANUAL' : 'MANUAL',
        lastSyncedAt: input.followers != null ? new Date() : null,
      },
      select: accountSelect,
    });

    await snapshot(account.id, {
      followers: account.followers,
      following: account.following,
      postCount: account.postCount,
      source: 'MANUAL',
    });

    if (input.isPrimary || !influencer.primaryPlatform) {
      await prisma.influencer.update({
        where: { id: influencer.id },
        data: {
          primaryPlatform: influencer.primaryPlatform ?? input.platform,
          primaryUsername: influencer.primaryUsername ?? input.username,
          resolvedAvatarUrl: influencer.resolvedAvatarUrl ?? input.avatarUrl ?? undefined,
        },
      });
    }

    await logActivity(ctx, {
      type: 'SOCIAL_ACCOUNT_ADDED',
      message: `${ctx.actor?.name ?? 'Someone'} linked a ${input.platform} account (@${input.username}) to ${influencer.displayName}.`,
      influencerId: influencer.id,
    });

    return toSocialAccountDTO(account);
  }

  async function update(id: string, input: SocialAccountUpdate): Promise<SocialAccountDTO> {
    requireActor(ctx);
    const existing = await prisma.socialAccount.findUnique({ where: { id }, select: accountSelect });
    if (!existing) throw AppError.notFound('Social account');

    const account = await prisma.socialAccount.update({
      where: { id },
      data: {
        username: input.username ?? undefined,
        profileUrl: input.profileUrl === undefined ? undefined : input.profileUrl,
        displayName: input.displayName === undefined ? undefined : input.displayName,
        avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl,
        bio: input.bio === undefined ? undefined : input.bio,
        followers: input.followers === undefined ? undefined : input.followers,
        following: input.following === undefined ? undefined : input.following,
        postCount: input.postCount === undefined ? undefined : input.postCount,
        isVerified: input.isVerified === undefined ? undefined : input.isVerified,
        isPrimary: input.isPrimary ?? undefined,
        dataSource: input.followers !== undefined ? 'MANUAL' : undefined,
        lastSyncedAt: input.followers !== undefined ? new Date() : undefined,
      },
      select: accountSelect,
    });

    if (input.followers !== undefined && input.followers !== existing.followers) {
      await snapshot(account.id, {
        followers: account.followers,
        following: account.following,
        postCount: account.postCount,
        source: 'MANUAL',
      });
    }
    return toSocialAccountDTO(account);
  }

  /** Attempt an official sync via the platform adapter; graceful on failure. */
  async function sync(id: string): Promise<{ account: SocialAccountDTO; synced: boolean; message: string }> {
    requireActor(ctx);
    const existing = await prisma.socialAccount.findUnique({ where: { id }, select: accountSelect });
    if (!existing) throw AppError.notFound('Social account');

    const adapter = getAdapter(existing.platform, { credentials: ctx.credentials });
    const result = await adapter.syncProfile({
      username: existing.username,
      profileUrl: existing.profileUrl,
      platformUserId: existing.platformUserId,
    });

    if (!result.ok) {
      return {
        account: toSocialAccountDTO(existing),
        synced: false,
        message: result.message,
      };
    }

    const d = result.data;
    const account = await prisma.socialAccount.update({
      where: { id },
      data: {
        followers: d.followers ?? existing.followers,
        following: d.following ?? existing.following,
        postCount: d.postCount ?? existing.postCount,
        isVerified: d.isVerified ?? existing.isVerified,
        avatarUrl: d.avatarUrl ?? existing.avatarUrl,
        displayName: d.displayName ?? existing.displayName,
        dataSource: 'OFFICIAL_API',
        lastSyncedAt: new Date(),
      },
      select: accountSelect,
    });
    await snapshot(account.id, {
      followers: account.followers,
      following: account.following,
      postCount: account.postCount,
      source: 'OFFICIAL_API',
    });
    return { account: toSocialAccountDTO(account), synced: true, message: 'Synced from official API.' };
  }

  async function remove(id: string): Promise<void> {
    requireActor(ctx);
    const existing = await prisma.socialAccount.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Social account');
    await prisma.socialAccount.delete({ where: { id } });
  }

  return { create, update, sync, remove, snapshot };
}

export type SocialAccountService = ReturnType<typeof makeSocialAccountService>;
