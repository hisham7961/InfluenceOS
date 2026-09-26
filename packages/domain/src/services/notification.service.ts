import {
  requests,
  type CursorPage,
  type DigestDTO,
  type NotificationDTO,
  type NotificationSettingsDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { windowArgs, windowPage } from '../lib/cursor';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { toNotificationDTO } from '../lib/mappers';
import { scopedBrandIds, scopedCountryCodes } from '../lib/scope';
import { buildDigest } from '../lib/digest';
import { emailConfigFromEnv, smtpMailer, type EmailConfig, type Mailer } from '../lib/email/config';
import { emailLocale } from '../lib/email/i18n';
import { renderTestEmail } from '../lib/email/templates';

type NotificationFilter = z.infer<typeof requests.notificationFilterSchema>;
type MarkReadInput = z.infer<typeof requests.markReadSchema>;
type SettingsInput = z.infer<typeof requests.notificationSettingsSchema>;

/** Tests swap the email transport; null = use SMTP_URL. */
let testTransport: { config: EmailConfig; mailer: Mailer } | null = null;
export function __setTestEmailTransport(t: { config: EmailConfig; mailer: Mailer } | null): void {
  testTransport = t;
}
function emailTransport(): { config: EmailConfig; mailer: Mailer } | null {
  if (testTransport) return testTransport;
  const config = emailConfigFromEnv();
  return config ? { config, mailer: smtpMailer(config) } : null;
}

const testEmailSentAt = new Map<string, number>();

/**
 * In-app notifications for the current actor (spec §22).
 *
 * A notification with a userId is that person's; one without is for the
 * whole team, shown to everyone who can see what it's about — its brand and
 * its creator's country (P2.6). Read state is per person: your own
 * notifications carry isRead/readAt; a team-wide one is read for you once
 * you have a NotificationRead row, so marking it read never clears it for
 * anyone else. (Team-wide rows already marked read before per-person read
 * state existed stay read for everyone.)
 */
export function makeNotificationService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function visibleWhere(actorId: string): Promise<Prisma.NotificationWhereInput> {
    const [brands, countries] = await Promise.all([scopedBrandIds(ctx), scopedCountryCodes(ctx)]);
    const team: Prisma.NotificationWhereInput[] = [{ userId: null }];
    if (brands) team.push({ OR: [{ brandId: null }, { brandId: { in: brands } }] });
    if (countries) team.push({ OR: [{ influencerId: null }, { influencer: { countryCode: { in: countries } } }] });
    return { OR: [{ userId: actorId }, { AND: team }] };
  }

  const unreadWhere = (actorId: string): Prisma.NotificationWhereInput => ({
    isRead: false,
    OR: [{ userId: actorId }, { userId: null, reads: { none: { userId: actorId } } }],
  });

  async function list(filter: NotificationFilter): Promise<CursorPage<NotificationDTO>> {
    const actor = requireActor(ctx);
    const where: Prisma.NotificationWhereInput = {
      AND: [await visibleWhere(actor.id), ...(filter.unreadOnly ? [unreadWhere(actor.id)] : [])],
    };

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { reads: { where: { userId: actor.id }, select: { readAt: true } } },
        ...windowArgs(filter),
      }),
      filter.page ? prisma.notification.count({ where }) : null,
    ]);

    const page = windowPage(rows, filter, total);
    return {
      ...page,
      data: page.data.map((n) => toNotificationDTO({ ...n, isRead: n.isRead || n.reads.length > 0 })),
    };
  }

  async function unreadCount(): Promise<number> {
    const actor = requireActor(ctx);
    return prisma.notification.count({
      where: { AND: [await visibleWhere(actor.id), unreadWhere(actor.id)] },
    });
  }

  async function markRead(input: MarkReadInput): Promise<{ updated: number }> {
    const actor = requireActor(ctx);
    if (!input.all && (!input.ids || input.ids.length === 0)) {
      throw AppError.badRequest('Provide notification ids or set all to true.');
    }
    const now = new Date();
    const visible = await visibleWhere(actor.id);
    const which: Prisma.NotificationWhereInput = input.all ? {} : { id: { in: input.ids! } };

    // Your own notifications.
    const own = await prisma.notification.updateMany({
      where: { AND: [which, { userId: actor.id, isRead: false }] },
      data: { isRead: true, readAt: now },
    });
    // Team-wide ones: a read row for you only.
    const team = await prisma.notification.findMany({
      where: { AND: [which, visible, { userId: null, isRead: false, reads: { none: { userId: actor.id } } }] },
      select: { id: true },
      take: 5000,
    });
    if (team.length) {
      await prisma.notificationRead.createMany({
        data: team.map((n) => ({ userId: actor.id, notificationId: n.id, readAt: now })),
        skipDuplicates: true,
      });
    }
    return { updated: own.count + team.length };
  }

  async function settings(): Promise<NotificationSettingsDTO> {
    const actor = requireActor(ctx);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { email: true, digestFrequency: true, emailCategories: true, lastDigestAt: true },
    });
    let emailConfigured = false;
    try {
      emailConfigured = !!emailTransport();
    } catch {
      emailConfigured = false;
    }
    return {
      digestFrequency: user.digestFrequency,
      emailCategories: user.emailCategories,
      emailConfigured,
      email: user.email,
      lastDigestAt: user.lastDigestAt?.toISOString() ?? null,
    };
  }

  async function updateSettings(input: SettingsInput): Promise<NotificationSettingsDTO> {
    const actor = requireActor(ctx);
    await prisma.user.update({
      where: { id: actor.id },
      data: {
        ...(input.digestFrequency ? { digestFrequency: input.digestFrequency } : {}),
        ...(input.emailCategories ? { emailCategories: [...new Set(input.emailCategories)] } : {}),
      },
    });
    return settings();
  }

  /** What your summary email would hold right now (last 24 hours for "taken down"). */
  async function digestPreview(): Promise<DigestDTO> {
    requireActor(ctx);
    const now = new Date();
    return buildDigest(ctx, { since: new Date(now.getTime() - 864e5), now });
  }

  /** Send yourself a test email (at most one a minute). */
  async function sendTestEmail(): Promise<{ sentTo: string }> {
    const actor = requireActor(ctx);
    let transport: ReturnType<typeof emailTransport>;
    try {
      transport = emailTransport();
    } catch (e) {
      throw AppError.conflict(`Email settings are not valid: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!transport) throw AppError.conflict('Email is not set up on this server yet.');
    const last = testEmailSentAt.get(actor.id) ?? 0;
    if (Date.now() - last < 60_000) throw AppError.conflict('A test email was just sent. Try again in a minute.');
    testEmailSentAt.set(actor.id, Date.now());

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { email: true, locale: true } });
    const email = renderTestEmail(emailLocale(user.locale), transport.config.appUrl);
    try {
      await transport.mailer({
        from: transport.config.from,
        to: user.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        rtl: email.rtl,
      });
    } catch (e) {
      throw AppError.conflict(`The mail server refused the test email: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { sentTo: user.email };
  }

  return { list, unreadCount, markRead, settings, updateSettings, digestPreview, sendTestEmail };
}

export type NotificationService = ReturnType<typeof makeNotificationService>;
