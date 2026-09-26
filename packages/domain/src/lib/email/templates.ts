import type { DigestDTO, DigestItemDTO, DigestSectionDTO, DigestFrequency } from '@influenceos/contracts';
import { absoluteAppUrl, appRoutes, fillTemplate } from '@influenceos/shared';
import { categoryText, enumText, serverText, type EmailLocale } from './i18n';

/**
 * The emails the worker sends (P2.6): one notification as it happens, and
 * the morning (or Sunday) summary. English or Arabic (right to left) per
 * the reader's language setting; times in Kuwait.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  rtl: boolean;
}

const COPY = {
  en: {
    daily: 'Your InfluenceOS summary — {date}',
    weekly: 'Your weekly InfluenceOS summary — {date}',
    greeting: 'Good morning {name},',
    introMine: 'Here is what needs attention on your campaigns and creators.',
    introAll: 'Here is what needs the team’s attention.',
    overdue: 'Overdue',
    dueSoon: 'Due today or tomorrow',
    reviews: 'Drafts waiting for review',
    removedDaily: 'Posts taken down since yesterday',
    removedWeekly: 'Posts taken down this week',
    expiring: 'Usage rights expiring',
    unpaid: 'Still owed',
    unpaidLine: '{count} fees and expenses still to pay: {totals}',
    due: 'due {date}',
    submitted: 'sent {date}',
    expires: 'expires {date}',
    more: 'and {count} more',
    open: 'Open InfluenceOS',
    view: 'Open in InfluenceOS',
    footerDigest: 'You get this summary {when}. Change it in Settings → Notifications.',
    whenDaily: 'every morning',
    whenWeekly: 'every Sunday morning',
    footerInstant: 'You get this email because you chose to be emailed about “{category}”. Change it in Settings → Notifications.',
    testSubject: 'InfluenceOS test email',
    testBody: 'Email from InfluenceOS works. Summaries and alerts you choose in Settings → Notifications will arrive at this address.',
  },
  ar: {
    daily: 'ملخّصك في InfluenceOS — {date}',
    weekly: 'ملخّصك الأسبوعي في InfluenceOS — {date}',
    greeting: 'صباح الخير {name}،',
    introMine: 'هذا ما يحتاج انتباهك في حملاتك ومؤثريك.',
    introAll: 'هذا ما يحتاج انتباه الفريق.',
    overdue: 'متأخر',
    dueSoon: 'مستحق اليوم أو غدًا',
    reviews: 'مسودات بانتظار المراجعة',
    removedDaily: 'منشورات أُزيلت منذ أمس',
    removedWeekly: 'منشورات أُزيلت هذا الأسبوع',
    expiring: 'حقوق استخدام تنتهي قريبًا',
    unpaid: 'مبالغ مستحقة الدفع',
    unpaidLine: 'أتعاب ومصروفات لم تُدفع بعد: {count} — {totals}',
    due: 'الاستحقاق {date}',
    submitted: 'أُرسلت {date}',
    expires: 'تنتهي {date}',
    more: 'و{count} غيرها',
    open: 'افتح InfluenceOS',
    view: 'افتحه في InfluenceOS',
    footerDigest: 'يصلك هذا الملخّص {when}. يمكنك تغييره من الإعدادات ← الإشعارات.',
    whenDaily: 'كل صباح',
    whenWeekly: 'صباح كل يوم أحد',
    footerInstant: 'وصلك هذا البريد لأنك اخترت استلام «{category}» بالبريد. يمكنك تغيير ذلك من الإعدادات ← الإشعارات.',
    testSubject: 'رسالة تجريبية من InfluenceOS',
    testBody: 'البريد من InfluenceOS يعمل. الملخّصات والتنبيهات التي تختارها من الإعدادات ← الإشعارات ستصل إلى هذا العنوان.',
  },
} as const;
type CopyKey = keyof (typeof COPY)['en'];

const c = (locale: EmailLocale, key: CopyKey, params: Record<string, string | number> = {}) =>
  fillTemplate(COPY[locale][key], Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** A date in Kuwait time, e.g. "3 Oct" / "٣ أكتوبر" (Western digits, as in the app). */
export function emailDate(iso: string | Date, locale: EmailLocale, withWeekday = false): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Kuwait',
    day: 'numeric',
    // Arabic month names in full ("٣ أكتوبر", not an abbreviation).
    month: locale === 'ar' ? 'long' : 'short',
    ...(withWeekday ? { weekday: 'long' } : {}),
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

function money(amount: string, currency: string, locale: EmailLocale): string {
  const n = Number(amount);
  const formatted = Number.isFinite(n)
    ? new Intl.NumberFormat(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-US', { maximumFractionDigits: 3 }).format(n)
    : amount;
  return `${formatted} ${currency}`;
}

function layout(locale: EmailLocale, bodyHtml: string, footer: string): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
<tr><td dir="${dir}" style="padding:24px;text-align:${align};font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td dir="${dir}" style="padding:16px 24px;border-top:1px solid #e4e4e7;text-align:${align};font-size:12px;color:#71717a">${escape(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0 0"><a href="${escape(href)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escape(label)}</a></p>`;

/** One notification, as it happens. */
export function renderNotificationEmail(
  n: { category: string; title: string; body: string | null; targetUrl: string | null },
  locale: EmailLocale,
  appUrl: string,
): RenderedEmail {
  const title = serverText(n.title, locale);
  const body = n.body ? serverText(n.body, locale) : '';
  const link = absoluteAppUrl(appUrl, n.targetUrl || appRoutes.notifications());
  const footer = c(locale, 'footerInstant', { category: categoryText(n.category, locale) });
  const html = layout(
    locale,
    `<h1 style="margin:0 0 8px;font-size:18px">${escape(title)}</h1>${body ? `<p style="margin:0">${escape(body)}</p>` : ''}${button(link, c(locale, 'view'))}`,
    footer,
  );
  const text = [title, body, '', `${c(locale, 'view')}: ${link}`, '', footer].filter((l, i) => l || i > 1).join('\n');
  return { subject: title, text, html, rtl: locale === 'ar' };
}

function itemLine(
  item: DigestItemDTO,
  group: 'deliverable' | 'review' | 'removed' | 'right',
  locale: EmailLocale,
): { main: string; detail: string } {
  const kind =
    group === 'removed'
      ? item.kind && enumText('contentStatus', item.kind, locale)
      : group === 'right'
        ? item.kind && enumText('usageRightType', item.kind, locale)
        : item.kind && enumText('deliverableType', item.kind, locale);
  const who = item.influencerName ?? item.brandName ?? '';
  const where = group === 'right' ? item.brandName : item.campaignName;
  const main = [who, kind].filter(Boolean).join(' · ');
  const date = item.at ? emailDate(item.at, locale) : '';
  const when = !date
    ? ''
    : group === 'deliverable'
      ? c(locale, 'due', { date })
      : group === 'review'
        ? c(locale, 'submitted', { date })
        : group === 'right'
          ? c(locale, 'expires', { date })
          : date;
  const detail = [where && where !== who ? where : '', when].filter(Boolean).join(' — ');
  return { main, detail };
}

/** The morning (or Sunday) summary. */
export function renderDigestEmail(
  digest: DigestDTO,
  opts: { locale: EmailLocale; appUrl: string; name: string; frequency: DigestFrequency },
): RenderedEmail {
  const { locale, appUrl } = opts;
  const weekly = opts.frequency === 'WEEKLY';
  const subject = c(locale, weekly ? 'weekly' : 'daily', { date: emailDate(digest.generatedAt, locale, true) });
  const sections: { title: string; data: DigestSectionDTO; group: 'deliverable' | 'review' | 'removed' | 'right' }[] = [
    { title: c(locale, 'overdue'), data: digest.overdue, group: 'deliverable' },
    { title: c(locale, 'dueSoon'), data: digest.dueSoon, group: 'deliverable' },
    { title: c(locale, 'reviews'), data: digest.reviews, group: 'review' },
    { title: c(locale, weekly ? 'removedWeekly' : 'removedDaily'), data: digest.removed, group: 'removed' },
    { title: c(locale, 'expiring'), data: digest.expiringRights, group: 'right' },
  ];

  const htmlParts: string[] = [
    `<p style="margin:0 0 4px">${escape(c(locale, 'greeting', { name: opts.name }))}</p>`,
    `<p style="margin:0 0 16px;color:#52525b">${escape(c(locale, digest.onlyMine ? 'introMine' : 'introAll'))}</p>`,
  ];
  const textParts: string[] = [c(locale, 'greeting', { name: opts.name }), c(locale, digest.onlyMine ? 'introMine' : 'introAll'), ''];

  for (const s of sections) {
    if (!s.data.total) continue;
    htmlParts.push(`<h2 style="margin:20px 0 8px;font-size:15px">${escape(s.title)} (${s.data.total})</h2><ul style="margin:0;padding-inline-start:20px">`);
    textParts.push(`${s.title} (${s.data.total})`);
    for (const item of s.data.items) {
      const { main, detail } = itemLine(item, s.group, locale);
      const href = absoluteAppUrl(appUrl, item.link);
      htmlParts.push(
        `<li style="margin:0 0 6px"><a href="${escape(href)}" style="color:#18181b;font-weight:600;text-decoration:none"><bdi>${escape(main)}</bdi></a>${
          detail ? `<br><span style="color:#71717a;font-size:13px"><bdi>${escape(detail)}</bdi></span>` : ''
        }</li>`,
      );
      textParts.push(`- ${main}${detail ? ` (${detail})` : ''}: ${href}`);
    }
    htmlParts.push('</ul>');
    const more = s.data.total - s.data.items.length;
    if (more > 0) {
      htmlParts.push(`<p style="margin:4px 0 0;color:#71717a;font-size:13px">${escape(c(locale, 'more', { count: more }))}</p>`);
      textParts.push(`  ${c(locale, 'more', { count: more })}`);
    }
    textParts.push('');
  }

  if (digest.unpaid) {
    const totals = digest.unpaid.totals.map((t) => money(t.amount, t.currency, locale)).join(' + ');
    const line = c(locale, 'unpaidLine', { count: digest.unpaid.count, totals });
    const href = absoluteAppUrl(appUrl, appRoutes.finance());
    htmlParts.push(
      `<h2 style="margin:20px 0 8px;font-size:15px">${escape(c(locale, 'unpaid'))}</h2><p style="margin:0"><a href="${escape(href)}" style="color:#18181b"><bdi>${escape(line)}</bdi></a></p>`,
    );
    textParts.push(c(locale, 'unpaid'), `${line}: ${href}`, '');
  }

  const home = absoluteAppUrl(appUrl, appRoutes.home());
  htmlParts.push(button(home, c(locale, 'open')));
  textParts.push(`${c(locale, 'open')}: ${home}`);
  const footer = c(locale, 'footerDigest', { when: c(locale, weekly ? 'whenWeekly' : 'whenDaily') });
  textParts.push('', footer);

  return { subject, text: textParts.join('\n'), html: layout(locale, htmlParts.join('\n'), footer), rtl: locale === 'ar' };
}

/** "Send a test email" from Settings → Notifications. */
export function renderTestEmail(locale: EmailLocale, appUrl: string): RenderedEmail {
  const footer = c(locale, 'footerDigest', { when: c(locale, 'whenDaily') });
  const link = absoluteAppUrl(appUrl, appRoutes.notificationSettings());
  return {
    subject: c(locale, 'testSubject'),
    text: `${c(locale, 'testBody')}\n\n${link}`,
    html: layout(locale, `<p style="margin:0">${escape(c(locale, 'testBody'))}</p>${button(link, c(locale, 'open'))}`, footer),
    rtl: locale === 'ar',
  };
}
