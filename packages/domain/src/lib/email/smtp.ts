import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

/**
 * A small SMTP client (P2.6) — enough to hand an email to the team's mail
 * server (Gmail/Google Workspace, Microsoft 365, Zoho, Amazon SES, a relay
 * on the host…) without a third-party library.
 *
 *   SMTP_URL=smtps://user:password@smtp.example.com:465   (TLS from the start)
 *   SMTP_URL=smtp://user:password@smtp.example.com:587    (upgraded with STARTTLS)
 *
 * A password is never sent over an unencrypted connection: if the server
 * doesn't offer STARTTLS the send fails, unless `?insecure=1` is added (only
 * for a relay on the same machine or a test server).
 */

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS from the first byte (smtps://, usually port 465). */
  secure: boolean;
  user?: string;
  pass?: string;
  /** Allow sending (and logging in) without TLS. */
  insecure: boolean;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Right-to-left body (Arabic). */
  rtl?: boolean;
}

/** Parse SMTP_URL; throws with a readable reason when it's malformed. */
export function parseSmtpUrl(value: string): SmtpConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SMTP_URL is not a valid URL (expected smtp://user:pass@host:587 or smtps://user:pass@host:465).');
  }
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
    throw new Error('SMTP_URL must start with smtp:// or smtps://.');
  }
  if (!url.hostname) throw new Error('SMTP_URL has no host.');
  const secure = url.protocol === 'smtps:';
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  return {
    host: url.hostname,
    port,
    secure,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    pass: url.password ? decodeURIComponent(url.password) : undefined,
    insecure: ['1', 'true', 'yes'].includes((url.searchParams.get('insecure') ?? '').toLowerCase()),
  };
}

/** The bare address in "Name <addr@x>" or "addr@x". */
export function addressOf(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1]! : value).trim();
}

const noNewlines = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

function encodeHeader(value: string): string {
  const clean = noNewlines(value);
  // Plain ASCII needs no encoding; anything else goes as an RFC 2047 word.
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function encodeAddress(value: string): string {
  const clean = noNewlines(value);
  const m = /^(.*?)\s*<([^>]+)>$/.exec(clean);
  if (!m || !m[1]) return `<${addressOf(clean)}>`;
  const name = m[1].replace(/^"|"$/g, '');
  return `${/^[\w .-]*$/.test(name) ? `"${name}"` : encodeHeader(name)} <${m[2]!.trim()}>`;
}

function base64Lines(text: string): string {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

/** The full RFC 5322 message (headers + multipart body) for a mail. */
export function buildMime(msg: MailMessage, now = new Date()): string {
  const boundary = `iob-${crypto.randomBytes(12).toString('hex')}`;
  const domain = addressOf(msg.from).split('@')[1] || 'localhost';
  const headers = [
    `From: ${encodeAddress(msg.from)}`,
    `To: ${encodeAddress(msg.to)}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
  ];
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(body)].join('\r\n');
  if (!msg.html) {
    return [...headers, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64Lines(msg.text)].join('\r\n');
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', msg.text),
    part('text/html', msg.html),
    `--${boundary}--`,
  ].join('\r\n');
}

interface Reply {
  code: number;
  lines: string[];
}

/** Reads SMTP replies (a reply ends at "NNN " — a code followed by a space). */
class ReplyReader {
  private buffer = '';
  private lines: string[] = [];
  private waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(socket: net.Socket) {
    this.attach(socket);
  }

  attach(socket: net.Socket) {
    // Replies are ASCII; decode per chunk (no setEncoding — the raw socket
    // may be handed to TLS for STARTTLS).
    socket.on('data', (chunk: Buffer | string) => this.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('The mail server closed the connection.')));
  }

  private push(chunk: string) {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, '');
      this.buffer = this.buffer.slice(i + 1);
      this.lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.lines };
        this.lines = [];
        const w = this.waiting;
        this.waiting = null;
        w?.resolve(reply);
      }
    }
  }

  private fail(e: Error) {
    if (!this.failure) this.failure = e;
    const w = this.waiting;
    this.waiting = null;
    w?.reject(this.failure);
  }

  next(): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
}

export interface SendOptions {
  timeoutMs?: number;
  /** Extra TLS options (tests use a self-signed certificate). */
  tls?: tls.ConnectionOptions;
  now?: Date;
}

/** Hand one message to the mail server. Throws with the server's reason on failure. */
export async function sendSmtp(cfg: SmtpConfig, msg: MailMessage, opts: SendOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let socket: net.Socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...opts.tls }, () => resolve(s))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(timeoutMs, () => s.destroy(new Error(`The mail server did not answer within ${Math.round(timeoutMs / 1000)}s.`)));
  });
  const reader = new ReplyReader(socket);
  let encrypted = cfg.secure;

  const expect = async (codes: number[], what: string) => {
    const reply = await reader.next();
    if (!codes.includes(reply.code)) {
      throw new Error(`${what}: ${reply.lines.join(' ').slice(0, 300)}`);
    }
    return reply;
  };
  const command = async (line: string, codes: number[], what: string) => {
    socket.write(`${line}\r\n`);
    return expect(codes, what);
  };

  try {
    await expect([220], 'The mail server refused the connection');
    const helloName = noNewlines(os.hostname() || 'localhost').replace(/[^\w.-]/g, '') || 'localhost';
    let ehlo = await command(`EHLO ${helloName}`, [250], 'EHLO was refused');

    const offers = (word: string) => ehlo.lines.some((l) => l.slice(4).toUpperCase().startsWith(word));
    if (!encrypted && offers('STARTTLS')) {
      await command('STARTTLS', [220], 'STARTTLS was refused');
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      socket = await new Promise<net.Socket>((resolve, reject) => {
        const s = tls.connect({ socket, servername: cfg.host, ...opts.tls }, () => resolve(s));
        s.once('error', reject);
      });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('The mail server stopped answering.')));
      reader.attach(socket);
      encrypted = true;
      ehlo = await command(`EHLO ${helloName}`, [250], 'EHLO after STARTTLS was refused');
    }
    if (!encrypted && !cfg.insecure) {
      throw new Error(
        'The mail server does not offer an encrypted connection (STARTTLS). Use smtps:// (port 465), or add ?insecure=1 only for a relay on this machine.',
      );
    }

    if (cfg.user) {
      const authLine = ehlo.lines.find((l) => l.slice(4).toUpperCase().startsWith('AUTH')) ?? '';
      if (/\bPLAIN\b/i.test(authLine) || !/\bLOGIN\b/i.test(authLine)) {
        const token = Buffer.from(`\0${cfg.user}\0${cfg.pass ?? ''}`, 'utf8').toString('base64');
        await command(`AUTH PLAIN ${token}`, [235], 'The mail server rejected the username or password');
      } else {
        await command('AUTH LOGIN', [334], 'AUTH LOGIN was refused');
        await command(Buffer.from(cfg.user, 'utf8').toString('base64'), [334], 'The mail server rejected the username');
        await command(Buffer.from(cfg.pass ?? '', 'utf8').toString('base64'), [235], 'The mail server rejected the username or password');
      }
    }

    await command(`MAIL FROM:<${addressOf(msg.from)}>`, [250], 'The sender address was refused');
    await command(`RCPT TO:<${addressOf(noNewlines(msg.to))}>`, [250, 251], 'The recipient address was refused');
    await command('DATA', [354], 'DATA was refused');
    // Dot-stuffing: a line that starts with "." gets a second one.
    const body = buildMime(msg, opts.now).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(`${body}\r\n.\r\n`);
    await expect([250], 'The mail server did not accept the message');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
    socket.destroy();
  }
}
