import type { NotificationCategory } from '@influenceos/contracts';
import type { PrismaClient } from '@influenceos/database';
import { addBusinessDays, businessDateKey, startOfBusinessDay } from '@influenceos/shared';
import { createContext } from '../../context';
import { buildDigest } from '../digest';
import type { Mailer } from './config';
import { emailLocale } from './i18n';
import { renderDigestEmail, renderNotificationEmail } from './templates';

/**
 * The worker's email step (P2.6).
 *
 * 1. Notifications as they happen: each new notification is looked at once
 *    (emailCheckedAt). Its recipients — the person it's addressed to, or for
 *    a team-wide one everyone who can see it (brand and country scope) — get
 *    it by email when they chose that kind in Settings → Notifications. Each
 *    send is recorded as an EMAIL NotificationDelivery (retried twice on
 *    failure). Without email set up, notifications are marked looked-at and
 *    nothing is sent, so switching email on later doesn't flood anyone.
 * 2. The summary: at 8:00 Kuwait time (daily), or 8:00 on Sunday (weekly),
 *    once per period per person, only when something needs attention.
 */
export interface EmailRunOptions {
  /** null = email isn't set up. */
  mailer: Mailer | null;
  from: string;
  appUrl: string;
  now?: Date;
  batch?: number;
  /** Summaries only: limit to these people (e.g. "send mine now"). */
  userIds?: string[];
}

const DAY = 864e5;
const MAX_ATTEMPTS = 3;
export const DIGEST_HOUR_KUWAIT = 8;

type Recipient = { id: string; email: string; locale: string };

async function recipientsFor(
  prisma: PrismaClient,
  n: { userId: string | null; category: NotificationCategory; brandId: string | null; influencerId: string | null; countryCode: string | null },
): Promise<Recipient[]> {
  const select = { id: true, email: true, locale: true } as const;
  if (n.userId) {
    const u = await prisma.user.findFirst({
      where: { id: n.userId, isActive: true, emailCategories: { has: n.category } },
      select,
    });
    return u ? [u] : [];
  }
  const users = await prisma.user.findMany({
    where: { isActive: true, emailCategories: { has: n.category } },
    select: { ...select, role: true, brandAccess: { select: { brandId: true } }, countryAccess: { select: { countryCode: true } } },
  });
  // Same visibility as the in-app list: a brand- or country-scoped person
  // only hears about their own brands and countries.
  return users.filter((u) => {
    if (u.role === 'ADMIN') return true;
    const brands = u.brandAccess.map((b) => b.brandId);
    if (brands.length && n.brandId && !brands.includes(n.brandId)) return false;
    const countries = u.countryAccess.map((c) => c.countryCode);
    if (countries.length && n.influencerId && (!n.countryCode || !countries.includes(n.countryCode))) return false;
    return true;
  });
}

export async function dispatchNotificationEmails(
  prisma: PrismaClient,
  opts: EmailRunOptions,
): Promise<{ sent: number; failed: number; checked: number }> {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? 50;
  let sent = 0;
  let failed = 0;

  if (!opts.mailer) {
    const r = await prisma.notification.updateMany({ where: { emailCheckedAt: null }, data: { emailCheckedAt: now } });
    return { sent, failed, checked: r.count };
  }

  // Anything older than a day is no longer worth an email.
  const stale = await prisma.notification.updateMany({
    where: { emailCheckedAt: null, createdAt: { lt: new Date(now.getTime() - DAY) } },
    data: { emailCheckedAt: now },
  });
  let checked = stale.count;

  const rows = await prisma.notification.findMany({
    where: { emailCheckedAt: null },
    orderBy: { createdAt: 'asc' },
    take: batch,
    select: {
      id: true,
      category: true,
      title: true,
      body: true,
      targetUrl: true,
      userId: true,
      brandId: true,
      influencerId: true,
      influencer: { select: { countryCode: true } },
    },
  });

  const send = async (to: Recipient, n: { category: string; title: string; body: string | null; targetUrl: string | null }) => {
    const email = renderNotificationEmail(n, emailLocale(to.locale), opts.appUrl);
    await opts.mailer!({ from: opts.from, to: to.email, subject: email.subject, text: email.text, html: email.html, rtl: email.rtl });
  };

  for (const n of rows) {
    // Claim it, so two workers never email the same notification.
    const claimed = await prisma.notification.updateMany({ where: { id: n.id, emailCheckedAt: null }, data: { emailCheckedAt: now } });
    if (!claimed.count) continue;
    checked++;
    const recipients = await recipientsFor(prisma, { ...n, countryCode: n.influencer?.countryCode ?? null });
    for (const to of recipients) {
      let error: string | null = null;
      try {
        await send(to, n);
        sent++;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 500) : 'Sending failed.';
        failed++;
      }
      await prisma.notificationDelivery.create({
        data: {
          notificationId: n.id,
          channel: 'EMAIL',
          status: error ? 'FAILED' : 'SENT',
          target: to.id,
          error,
          attempts: 1,
          deliveredAt: error ? null : now,
        },
      });
    }
  }

  // Retry failed sends from the last day: after 10 minutes, then 20.
  const retries = await prisma.notificationDelivery.findMany({
    where: { channel: 'EMAIL', status: 'FAILED', attempts: { lt: MAX_ATTEMPTS }, createdAt: { gte: new Date(now.getTime() - DAY) } },
    select: {
      id: true,
      target: true,
      attempts: true,
      createdAt: true,
      notification: { select: { category: true, title: true, body: true, targetUrl: true } },
    },
    take: batch,
  });
  for (const d of retries) {
    if (d.createdAt.getTime() > now.getTime() - d.attempts * 10 * 60_000) continue;
    const to = d.target
      ? await prisma.user.findFirst({ where: { id: d.target, isActive: true }, select: { id: true, email: true, locale: true } })
      : null;
    if (!to) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED' } });
      continue;
    }
    try {
      await send(to, d.notification);
      sent++;
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: 'SENT', attempts: d.attempts + 1, error: null, deliveredAt: now },
      });
    } catch (e) {
      failed++;
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { attempts: d.attempts + 1, error: e instanceof Error ? e.message.slice(0, 500) : 'Sending failed.' },
      });
    }
  }

  return { sent, failed, checked };
}

/**
 * When the current summary period started for a frequency: today at 8:00
 * Kuwait (daily), or the last Sunday at 8:00 (weekly, catching up for up to
 * two days if the worker was down). Null when none is due yet.
 */
export function digestPeriodStart(frequency: 'DAILY' | 'WEEKLY', now: Date): Date | null {
  const today = businessDateKey(now);
  const at = (key: string) => new Date(startOfBusinessDay(key).getTime() + DIGEST_HOUR_KUWAIT * 3600_000);
  if (frequency === 'DAILY') {
    const start = at(today);
    return now >= start ? start : null;
  }
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const sunday = at(addBusinessDays(today, -weekday));
  if (now < sunday || now.getTime() - sunday.getTime() > 2 * DAY) return null;
  return sunday;
}

const retryAfter = new Map<string, number>();

export async function sendDueDigests(
  prisma: PrismaClient,
  opts: EmailRunOptions,
): Promise<{ sent: number; empty: number; failed: number }> {
  const now = opts.now ?? new Date();
  const result = { sent: 0, empty: 0, failed: 0 };
  if (!opts.mailer) return result;

  for (const frequency of ['DAILY', 'WEEKLY'] as const) {
    const periodStart = digestPeriodStart(frequency, now);
    if (!periodStart) continue;
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        digestFrequency: frequency,
        OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: periodStart } }],
        ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
      },
      select: { id: true, name: true, email: true, role: true, roleProfile: true, locale: true, lastDigestAt: true },
      orderBy: { id: 'asc' },
      take: opts.batch ?? 25,
    });
    for (const u of users) {
      if ((retryAfter.get(u.id) ?? 0) > now.getTime()) continue;
      const window = frequency === 'WEEKLY' ? 7 * DAY : DAY;
      const since = new Date(Math.max(u.lastDigestAt?.getTime() ?? 0, now.getTime() - window));
      const ctx = createContext({ prisma, actor: { id: u.id, name: u.name, role: u.role, roleProfile: u.roleProfile } });
      try {
        const digest = await buildDigest(ctx, { since, now });
        if (!digest.isEmpty) {
          const email = renderDigestEmail(digest, { locale: emailLocale(u.locale), appUrl: opts.appUrl, name: u.name, frequency });
          await opts.mailer({ from: opts.from, to: u.email, subject: email.subject, text: email.text, html: email.html, rtl: email.rtl });
          result.sent++;
        } else {
          result.empty++;
        }
        await prisma.user.update({ where: { id: u.id }, data: { lastDigestAt: now } });
        retryAfter.delete(u.id);
      } catch (e) {
        result.failed++;
        retryAfter.set(u.id, now.getTime() + 30 * 60_000);
        console.error(`[email] summary for user ${u.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}

/** Test hook. */
export function __resetDigestRetries(): void {
  retryAfter.clear();
}
