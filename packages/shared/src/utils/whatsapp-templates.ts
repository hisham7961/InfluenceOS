import type { ContactPurpose } from '../constants/enums';

/**
 * Ready-to-send WhatsApp messages for the everyday creator conversations:
 * the brief, the offer, a shipment on its way, confirming an address and
 * asking for changes. Both languages live here (not in messages/*.json)
 * because the message language is picked per creator, independent of the
 * language the app is shown in. The text is always editable before sending.
 */

export type WhatsAppLanguage = 'ar' | 'en';

export interface WhatsAppTemplateDeliverable {
  type: string;
  platform: string;
  dueDate?: string | null;
}

export interface WhatsAppTemplateContext {
  creatorName: string;
  brandName?: string | null;
  campaignName?: string | null;
  deliverables?: WhatsAppTemplateDeliverable[];
  /** Agreed fee on a paid deal. */
  fee?: { amount: number; currency: string } | null;
  /** Offer is a product, not money. */
  gifted?: boolean;
  courier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  /** Review feedback for a changes request. */
  feedback?: string | null;
  /** Brief details from the deliverable. */
  requirements?: string | null;
  hashtags?: string[];
  mentions?: string[];
  /** The creator's task link (P3.3): brief, tasks, and where to send drafts and the post link. */
  taskLinkUrl?: string | null;
}

const TYPE_AR: Record<string, string> = {
  POST: 'منشور',
  STORY: 'ستوري',
  REEL: 'ريل',
  SHORT: 'فيديو قصير',
  VIDEO: 'فيديو',
  LIVE: 'بث مباشر',
  TWEET: 'تغريدة',
  SNAP: 'سناب',
  CAROUSEL: 'منشور صور متعددة',
  UGC: 'محتوى UGC',
  OTHER: 'محتوى',
};
const TYPE_EN: Record<string, string> = {
  POST: 'Post',
  STORY: 'Story',
  REEL: 'Reel',
  SHORT: 'Short',
  VIDEO: 'Video',
  LIVE: 'Live',
  TWEET: 'Post on X',
  SNAP: 'Snap',
  CAROUSEL: 'Carousel',
  UGC: 'UGC video',
  OTHER: 'Content',
};
const PLATFORM_AR: Record<string, string> = {
  INSTAGRAM: 'إنستغرام',
  TIKTOK: 'تيك توك',
  YOUTUBE: 'يوتيوب',
  SNAPCHAT: 'سناب شات',
  X: 'إكس',
};
const PLATFORM_EN: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  SNAPCHAT: 'Snapchat',
  X: 'X',
};

/**
 * The language to write to a creator in, from the languages on their
 * profile (free text such as "Arabic", "English", "العربية"): the first one
 * we have templates for. Null when none is recognised.
 */
export function creatorMessageLanguage(languages: readonly string[] | null | undefined): WhatsAppLanguage | null {
  for (const raw of languages ?? []) {
    const l = raw.trim().toLowerCase();
    if (/^(ar|arabic|عربي|العربية)/.test(l)) return 'ar';
    if (/^(en|english|انجليزي|إنجليزي|الانجليزية|الإنجليزية)/.test(l)) return 'en';
  }
  return null;
}

/** "Thursday 1 October" / "الخميس، 1 أكتوبر" on the Kuwait calendar day. */
export function whatsappDate(iso: string, lang: WhatsAppLanguage): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kuwait',
  }).format(new Date(iso));
}

function money(fee: { amount: number; currency: string }, lang: WhatsAppLanguage): string {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', {
      style: 'currency',
      currency: fee.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(fee.amount);
  } catch {
    return `${fee.amount} ${fee.currency}`;
  }
}

function deliverableLines(list: WhatsAppTemplateDeliverable[] | undefined, lang: WhatsAppLanguage): string[] {
  return (list ?? []).map((d) => {
    const type = (lang === 'ar' ? TYPE_AR : TYPE_EN)[d.type] ?? d.type;
    const platform = (lang === 'ar' ? PLATFORM_AR : PLATFORM_EN)[d.platform] ?? d.platform;
    const due = d.dueDate ? (lang === 'ar' ? ` — قبل ${whatsappDate(d.dueDate, lang)}` : ` — by ${whatsappDate(d.dueDate, lang)}`) : '';
    return lang === 'ar' ? `• ${type} على ${platform}${due}` : `• ${type} on ${platform}${due}`;
  });
}

/** "حملة X مع Y" / "the X campaign with Y", whichever parts are known. */
function about(ctx: WhatsAppTemplateContext, lang: WhatsAppLanguage): string {
  const { campaignName: c, brandName: b } = ctx;
  if (lang === 'ar') return c && b ? `حملة ${c} مع ${b}` : c ? `حملة ${c}` : b ? `التعاون مع ${b}` : 'التعاون معنا';
  return c && b ? `the ${c} campaign with ${b}` : c ? `the ${c} campaign` : b ? `working with ${b}` : 'working with us';
}

function join(lines: (string | null | undefined | false)[]): string {
  return lines.filter((l): l is string => typeof l === 'string').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The creator's task link, when there is one. */
function taskLink(ctx: WhatsAppTemplateContext, lang: WhatsAppLanguage): string | null {
  if (!ctx.taskLinkUrl) return null;
  return lang === 'ar'
    ? `كل التفاصيل في مكان واحد، ومنه ترسل المسودة ورابط المنشور:\n${ctx.taskLinkUrl}`
    : `Everything in one place, and where to send your draft and post link:\n${ctx.taskLinkUrl}`;
}

/** Requirements, hashtags and mentions to include in a brief. */
function briefExtras(ctx: WhatsAppTemplateContext, lang: WhatsAppLanguage): (string | null)[] {
  const ar = lang === 'ar';
  const tags = (ctx.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  const mentions = (ctx.mentions ?? []).map((m) => (m.startsWith('@') ? m : `@${m}`)).join(' ');
  return [
    ctx.requirements?.trim() ? (ar ? `المطلوب في المحتوى:\n${ctx.requirements.trim()}` : `Requirements:\n${ctx.requirements.trim()}`) : null,
    tags ? (ar ? `الهاشتاقات: ${tags}` : `Hashtags: ${tags}`) : null,
    mentions ? (ar ? `الإشارة إلى: ${mentions}` : `Mention: ${mentions}`) : null,
  ];
}

export function renderWhatsAppTemplate(purpose: ContactPurpose, lang: WhatsAppLanguage, ctx: WhatsAppTemplateContext): string {
  const name = ctx.creatorName;
  const items = deliverableLines(ctx.deliverables, lang);
  const ar = lang === 'ar';

  switch (purpose) {
    case 'BRIEF':
      return ar
        ? join([
            `مرحباً ${name}،`,
            `بخصوص ${about(ctx, lang)}، هذه تفاصيل المحتوى المطلوب:`,
            ...(items.length ? items : ['• (التفاصيل)']),
            '',
            ...briefExtras(ctx, lang),
            '',
            taskLink(ctx, lang),
            taskLink(ctx, lang) ? '' : null,
            'أرجو تأكيد الاستلام، وإذا عندك أي سؤال أنا في الخدمة.',
            'شكراً لك!',
          ])
        : join([
            `Hi ${name},`,
            `For ${about(ctx, lang)}, here's what we need:`,
            ...(items.length ? items : ['• (details)']),
            '',
            ...briefExtras(ctx, lang),
            '',
            taskLink(ctx, lang),
            taskLink(ctx, lang) ? '' : null,
            "Please confirm you've got this, and let me know if you have any questions.",
            'Thank you!',
          ]);

    case 'OFFER': {
      const pay = ctx.fee
        ? ar
          ? `المقابل: ${money(ctx.fee, lang)}${ctx.gifted ? ' + منتج هدية' : ''}`
          : `Fee: ${money(ctx.fee, lang)}${ctx.gifted ? ' + a gifted product' : ''}`
        : ctx.gifted
          ? ar
            ? 'المقابل: منتج هدية'
            : "In return: we'll send you the product"
          : null;
      return ar
        ? join([
            `مرحباً ${name}،`,
            `يسعدنا التعاون معك في ${about(ctx, lang)}.`,
            items.length ? 'المطلوب:' : null,
            ...items,
            pay,
            '',
            'هل يناسبك؟ بانتظار ردك.',
          ])
        : join([
            `Hi ${name},`,
            `We'd love to work with you on ${about(ctx, lang)}.`,
            items.length ? 'What we need:' : null,
            ...items,
            pay,
            '',
            'Does this work for you? Looking forward to hearing from you.',
          ]);
    }

    case 'SHIPMENT':
      return ar
        ? join([
            `مرحباً ${name}،`,
            `تم إرسال طلبك الخاص ب${about(ctx, lang)}.`,
            ctx.courier ? `شركة الشحن: ${ctx.courier}` : null,
            ctx.trackingNumber ? `رقم التتبع: ${ctx.trackingNumber}` : null,
            ctx.trackingUrl ?? null,
            '',
            'أرجو إبلاغنا عند الاستلام. شكراً!',
          ])
        : join([
            `Hi ${name},`,
            `Your package for ${about(ctx, lang)} is on its way.`,
            ctx.courier ? `Courier: ${ctx.courier}` : null,
            ctx.trackingNumber ? `Tracking number: ${ctx.trackingNumber}` : null,
            ctx.trackingUrl ?? null,
            '',
            'Please let us know when it arrives. Thank you!',
          ]);

    case 'ADDRESS':
      return ar
        ? join([
            `مرحباً ${name}،`,
            `نحتاج نتأكد من عنوان التوصيل الخاص ب${about(ctx, lang)}. ممكن ترسل لنا:`,
            '• المنطقة والقطعة',
            '• الشارع والجادة (إن وُجدت)',
            '• رقم المنزل أو العمارة والشقة',
            '• رقم للتواصل وقت التوصيل',
            '',
            'شكراً!',
          ])
        : join([
            `Hi ${name},`,
            `We need to confirm your delivery address for ${about(ctx, lang)}. Could you send us:`,
            '• Area and block',
            '• Street and avenue (if any)',
            '• House, or building and flat number',
            '• A phone number for the courier',
            '',
            'Thank you!',
          ]);

    case 'CHANGES':
      return ar
        ? join([
            `مرحباً ${name}،`,
            `شكراً على المسودة الخاصة ب${about(ctx, lang)}. نحتاج بعض التعديلات:`,
            ctx.feedback ? ctx.feedback : '• (التعديلات)',
            '',
            'بانتظار النسخة المعدّلة. شكراً لك!',
          ])
        : join([
            `Hi ${name},`,
            `Thanks for the draft for ${about(ctx, lang)}. We'd like a few changes:`,
            ctx.feedback ? ctx.feedback : '• (changes)',
            '',
            'Looking forward to the updated version. Thank you!',
          ]);

    case 'GENERAL':
    default:
      return ar ? `مرحباً ${name}،\n` : `Hi ${name},\n`;
  }
}
