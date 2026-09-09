import {
  buildEmbed,
  profileUrl as buildProfileUrl,
  type Platform,
} from '@influenceos/shared';
import type {
  ActivityDTO,
  BrandSummaryDTO,
  ContentMetricsDTO,
  DataSource,
  ExpenseDTO,
  InfluencerSummaryDTO,
  NotificationDTO,
  ProvenanceDTO,
  PublishedContentDTO,
  SocialAccountDTO,
} from '@influenceos/contracts';
import { iso } from './helpers';
import { moneyNumberOr0, type MoneyInput } from './money';

/*
 * Mappers translate persistence rows into API DTOs. They accept structural
 * input types (only the fields they read) so any Prisma payload selecting those
 * fields is valid — DTOs never expose raw Prisma models (addendum §7).
 */

interface BrandLike {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string | null;
  isActive: boolean;
}

export function toBrandSummary(b: BrandLike): BrandSummaryDTO {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    logoUrl: b.logoUrl,
    iconUrl: b.iconUrl,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    isActive: b.isActive,
  };
}

interface SocialAccountLike {
  id: string;
  platform: Platform;
  username: string;
  profileUrl: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  postCount: number | null;
  isVerified: boolean | null;
  isPrimary: boolean;
  dataSource: DataSource;
  lastSyncedAt: Date | null;
}

export function toSocialAccountDTO(
  a: SocialAccountLike,
  extra: { followerDelta7d?: number | null } = {},
): SocialAccountDTO {
  return {
    id: a.id,
    platform: a.platform,
    username: a.username,
    profileUrl: a.profileUrl ?? buildProfileUrl(a.platform, a.username),
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    followers: a.followers,
    following: a.following,
    postCount: a.postCount,
    isVerified: a.isVerified,
    isPrimary: a.isPrimary,
    followerDelta7d: extra.followerDelta7d ?? null,
    provenance: { source: a.dataSource, updatedAt: iso(a.lastSyncedAt) },
  };
}

interface InfluencerSummaryLike {
  id: string;
  displayName: string;
  primaryUsername: string | null;
  primaryPlatform: Platform | null;
  avatarOverrideUrl: string | null;
  resolvedAvatarUrl: string | null;
  country: string | null;
  category: string | null;
  relationshipStatus: InfluencerSummaryDTO['relationshipStatus'];
  priority: InfluencerSummaryDTO['priority'];
  audienceHealth: InfluencerSummaryDTO['audienceHealth'];
  isActive: boolean;
  socialAccounts: {
    platform: Platform;
    followers: number | null;
    isPrimary: boolean;
    avatarUrl: string | null;
  }[];
  tags: { tag: { name: string } }[];
}

export function toInfluencerSummary(
  inf: InfluencerSummaryLike,
  extra: { activeCampaigns?: number } = {},
): InfluencerSummaryDTO {
  const perPlatform = new Map<Platform, number | null>();
  for (const acc of inf.socialAccounts) {
    const cur = perPlatform.get(acc.platform);
    if (acc.followers != null && (cur == null || acc.followers > cur)) {
      perPlatform.set(acc.platform, acc.followers);
    } else if (!perPlatform.has(acc.platform)) {
      perPlatform.set(acc.platform, acc.followers ?? null);
    }
  }
  const followersByPlatform = Array.from(perPlatform.entries()).map(([platform, followers]) => ({
    platform,
    followers,
  }));
  const followerValues = followersByPlatform.map((f) => f.followers).filter((v): v is number => v != null);
  const totalFollowers = followerValues.length ? followerValues.reduce((a, b) => a + b, 0) : null;

  const primaryAccount =
    inf.socialAccounts.find((a) => a.isPrimary) ?? inf.socialAccounts[0] ?? null;
  const avatarUrl = inf.avatarOverrideUrl ?? inf.resolvedAvatarUrl ?? primaryAccount?.avatarUrl ?? null;

  return {
    id: inf.id,
    displayName: inf.displayName,
    primaryUsername: inf.primaryUsername,
    avatarUrl,
    primaryPlatform: inf.primaryPlatform,
    country: inf.country,
    category: inf.category,
    relationshipStatus: inf.relationshipStatus,
    priority: inf.priority,
    audienceHealth: inf.audienceHealth,
    totalFollowers,
    platforms: followersByPlatform.map((f) => f.platform),
    followersByPlatform,
    tags: inf.tags.map((t) => t.tag.name),
    activeCampaigns: extra.activeCampaigns ?? 0,
    isActive: inf.isActive,
  };
}

interface ExpenseLike {
  id: string;
  campaignId: string;
  campaignInfluencerId: string | null;
  type: ExpenseDTO['type'];
  label: string | null;
  amount: MoneyInput;
  currency: string;
  paymentStatus: ExpenseDTO['paymentStatus'];
  incurredAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export function toExpenseDTO(e: ExpenseLike): ExpenseDTO {
  return {
    id: e.id,
    campaignId: e.campaignId,
    campaignInfluencerId: e.campaignInfluencerId,
    type: e.type,
    label: e.label,
    amount: moneyNumberOr0(e.amount),
    currency: e.currency,
    paymentStatus: e.paymentStatus,
    incurredAt: iso(e.incurredAt),
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

interface NotificationLike {
  id: string;
  category: NotificationDTO['category'];
  title: string;
  body: string | null;
  targetUrl: string | null;
  isRead: boolean;
  createdAt: Date;
}

export function toNotificationDTO(n: NotificationLike): NotificationDTO {
  return {
    id: n.id,
    category: n.category,
    title: n.title,
    body: n.body,
    targetUrl: n.targetUrl,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

interface ActivityLike {
  id: string;
  type: string;
  message: string;
  actor: { name: string } | null;
  brandId: string | null;
  campaignId: string | null;
  influencerId: string | null;
  publishedContentId: string | null;
  createdAt: Date;
}

export function toActivityDTO(a: ActivityLike): ActivityDTO {
  let link: string | null = null;
  if (a.campaignId) link = `/campaigns/${a.campaignId}`;
  else if (a.influencerId) link = `/influencers/${a.influencerId}`;
  else if (a.publishedContentId) link = `/content/${a.publishedContentId}`;
  else if (a.brandId) link = `/brands/${a.brandId}`;
  return {
    id: a.id,
    type: a.type,
    message: a.message,
    actorName: a.actor?.name ?? null,
    createdAt: a.createdAt.toISOString(),
    link,
  };
}

export interface ContentMetricLike {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
  engagementRate: number | null;
  capturedAt: Date | null;
  source: DataSource;
}

export function toContentMetricsDTO(m: ContentMetricLike | null): ContentMetricsDTO | null {
  if (!m) return null;
  return {
    views: m.views,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    reposts: m.reposts,
    saves: m.saves,
    engagementRate: m.engagementRate,
    capturedAt: iso(m.capturedAt),
    source: m.source,
  };
}

interface PublishedContentLike {
  id: string;
  platform: Platform;
  externalId: string | null;
  originalUrl: string;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  publishedAt: Date | null;
  detectedAt: Date;
  availabilityStatus: PublishedContentDTO['availabilityStatus'];
  lastCheckedAt: Date | null;
  lastMetricsSyncAt: Date | null;
  dataSource: DataSource;
}

export function toPublishedContentDTO(
  pc: PublishedContentLike,
  rel: {
    influencer?: InfluencerSummaryDTO | null;
    brand?: BrandSummaryDTO | null;
    campaign?: { id: string; name: string; slug: string } | null;
    metrics?: ContentMetricsDTO | null;
    provenanceUpdatedByName?: string | null;
  } = {},
): PublishedContentDTO {
  const embed = buildEmbed(pc.originalUrl, pc.platform);
  const provenance: ProvenanceDTO = {
    source: pc.dataSource,
    updatedAt: iso(pc.lastMetricsSyncAt ?? pc.lastCheckedAt),
    updatedByName: rel.provenanceUpdatedByName ?? null,
  };
  return {
    id: pc.id,
    platform: pc.platform,
    externalId: pc.externalId,
    originalUrl: pc.originalUrl,
    canonicalUrl: embed?.canonicalUrl ?? pc.originalUrl,
    embed,
    embeddable: !!embed && embed.kind !== 'link-only',
    thumbnailUrl: pc.thumbnailUrl,
    caption: pc.caption,
    publishedAt: iso(pc.publishedAt),
    detectedAt: pc.detectedAt.toISOString(),
    availabilityStatus: pc.availabilityStatus,
    lastCheckedAt: iso(pc.lastCheckedAt),
    lastMetricsSyncAt: iso(pc.lastMetricsSyncAt),
    provenance,
    influencer: rel.influencer ?? null,
    brand: rel.brand ?? null,
    campaign: rel.campaign ?? null,
    metrics: rel.metrics ?? null,
  };
}
