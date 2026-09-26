import { parseSmtpUrl, sendSmtp, type MailMessage, type SmtpConfig } from './smtp';

/**
 * Email settings (P2.6), all optional — without SMTP_URL nothing is emailed
 * and the app works exactly as before.
 *
 *   SMTP_URL   smtps://user:pass@smtp.example.com:465 (see smtp.ts)
 *   MAIL_FROM  "InfluenceOS <alerts@your-domain.com>" (defaults to the SMTP user)
 *   APP_URL    the address people open the app at, for links in emails
 *              (defaults to NEXT_PUBLIC_APP_URL, then the first WEB_ORIGIN)
 */
export interface EmailConfig {
  smtp: SmtpConfig;
  from: string;
  appUrl: string;
}

/** Sends one message; tests pass a fake. */
export type Mailer = (msg: MailMessage) => Promise<void>;

export function appUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const first = (env.WEB_ORIGIN ?? '').split(',')[0]?.trim();
  return (env.APP_URL || env.NEXT_PUBLIC_APP_URL || first || 'http://localhost:3000').replace(/\/+$/, '');
}

/** The email settings, or null when email isn't set up. Throws when SMTP_URL is malformed. */
export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const url = env.SMTP_URL?.trim();
  if (!url) return null;
  const smtp = parseSmtpUrl(url);
  const from = env.MAIL_FROM?.trim() || (smtp.user?.includes('@') ? `InfluenceOS <${smtp.user}>` : '');
  if (!from) throw new Error('MAIL_FROM is required when the SMTP username is not an email address.');
  return { smtp, from, appUrl: appUrlFromEnv(env) };
}

export function smtpMailer(config: EmailConfig): Mailer {
  return (msg) => sendSmtp(config.smtp, msg);
}
