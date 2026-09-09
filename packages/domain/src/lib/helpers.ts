import { Prisma, type ActivityType, type NotificationCategory } from '@influenceos/database';
import type { DomainContext } from '../context';

/** Prisma Decimal | null → number | null. */
export function dec(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : Number(value.toString());
}

/** Date | null → ISO string | null. */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Required Date → ISO string. */
export function isoReq(value: Date): string {
  return value.toISOString();
}

export interface ActivityInput {
  type: ActivityType;
  message: string;
  brandId?: string | null;
  campaignId?: string | null;
  influencerId?: string | null;
  deliverableId?: string | null;
  publishedContentId?: string | null;
  meta?: Prisma.InputJsonValue;
}

/** Write a human-readable activity record (spec §32). */
export async function logActivity(ctx: DomainContext, input: ActivityInput): Promise<void> {
  await ctx.prisma.activityLog.create({
    data: {
      type: input.type,
      message: input.message,
      actorId: ctx.actor?.id ?? null,
      brandId: input.brandId ?? null,
      campaignId: input.campaignId ?? null,
      influencerId: input.influencerId ?? null,
      deliverableId: input.deliverableId ?? null,
      publishedContentId: input.publishedContentId ?? null,
      meta: input.meta ?? Prisma.JsonNull,
    },
  });
}

export interface NotificationInput {
  category: NotificationCategory;
  title: string;
  body?: string | null;
  targetUrl?: string | null;
  userId?: string | null;
  brandId?: string | null;
  influencerId?: string | null;
  campaignId?: string | null;
  publishedContentId?: string | null;
}

/**
 * Create a notification and its IN_APP delivery record. Delivery channels are
 * independent (addendum §22) so adding PUSH/EMAIL later needs no rewrite here.
 */
export async function createNotification(
  ctx: DomainContext,
  input: NotificationInput,
): Promise<void> {
  await ctx.prisma.notification.create({
    data: {
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      targetUrl: input.targetUrl ?? null,
      userId: input.userId ?? null,
      brandId: input.brandId ?? null,
      influencerId: input.influencerId ?? null,
      campaignId: input.campaignId ?? null,
      publishedContentId: input.publishedContentId ?? null,
      deliveries: { create: { channel: 'IN_APP', status: 'SENT', deliveredAt: new Date() } },
    },
  });
}

/** Ensure a unique slug within a scope by probing the DB. */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const clean = base || 'item';
  if (!(await exists(clean))) return clean;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${clean}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${clean}-${Date.now()}`;
}

