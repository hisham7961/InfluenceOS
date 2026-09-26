import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMime, parseSmtpUrl, sendSmtp } from '../email/smtp';
import { digestPeriodStart } from '../email/dispatch';
import { renderDigestEmail } from '../email/templates';
import type { DigestDTO } from '@influenceos/contracts';

/**
 * The dependency-free SMTP client (P2.6), against a small fake mail server:
 * the conversation, login, dot-stuffing, encoded Arabic subjects, and that a
 * password is never sent over an unencrypted connection unless allowed.
 */
interface FakeServer {
  port: number;
  lines: string[];
  data: string;
  close: () => Promise<void>;
}

function fakeServer(opts: { starttls?: boolean; auth?: 'PLAIN' | 'LOGIN' } = {}): Promise<FakeServer> {
  const state = { lines: [] as string[], data: '' };
  const server = net.createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 queued\r\n');
          } else {
            state.data += `${line}\n`;
          }
          continue;
        }
        state.lines.push(line);
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) {
          const caps = ['250-fake'];
          if (opts.starttls) caps.push('250-STARTTLS');
          caps.push(`250 AUTH ${opts.auth ?? 'PLAIN LOGIN'}`);
          sock.write(caps.join('\r\n') + '\r\n');
        } else if (cmd.startsWith('AUTH PLAIN')) sock.write('235 ok\r\n');
        else if (cmd === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (state.lines.at(-2)?.toUpperCase() === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (state.lines.at(-3)?.toUpperCase() === 'AUTH LOGIN') sock.write('235 ok\r\n');
        else if (cmd.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (cmd.startsWith('RCPT TO')) sock.write(line.includes('bad@') ? '550 no such user\r\n' : '250 ok\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (cmd === 'QUIT') sock.end('221 bye\r\n');
        else sock.write('500 what\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        get lines() {
          return state.lines;
        },
        get data() {
          return state.data;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

let servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

const decodeBase64Parts = (raw: string) =>
  [...raw.matchAll(/Content-Transfer-Encoding: base64\n\n([\s\S]*?)(?:\n--|$)/g)].map((m) =>
    Buffer.from(m[1]!.replace(/\n/g, ''), 'base64').toString('utf8'),
  );

describe('SMTP client (P2.6)', () => {
  it('parses SMTP_URL', () => {
    expect(parseSmtpUrl('smtps://me%40x.com:p%40ss@smtp.x.com')).toEqual({
      host: 'smtp.x.com',
      port: 465,
      secure: true,
      user: 'me@x.com',
      pass: 'p@ss',
      insecure: false,
    });
    expect(parseSmtpUrl('smtp://relay.local:2525?insecure=1')).toMatchObject({ port: 2525, secure: false, insecure: true });
    expect(() => parseSmtpUrl('http://x')).toThrow(/smtp:\/\//);
    expect(() => parseSmtpUrl('not a url')).toThrow(/valid URL/);
  });

  it('delivers a message: login, sender, recipient, body with encoded Arabic subject', async () => {
    const s = await fakeServer();
    servers.push(s);
    await sendSmtp(
      { host: '127.0.0.1', port: s.port, secure: false, insecure: true, user: 'me@x.com', pass: 'secret' },
      {
        from: 'InfluenceOS <alerts@x.com>',
        to: 'Reader <reader@x.com>',
        subject: 'ملخّصك في InfluenceOS',
        text: 'Hello\n.dot line\nبالعربي',
        html: '<p>Hello</p>',
      },
    );
    expect(s.lines[0]).toMatch(/^EHLO /);
    expect(s.lines).toContain(`AUTH PLAIN ${Buffer.from('\0me@x.com\0secret').toString('base64')}`);
    expect(s.lines).toContain('MAIL FROM:<alerts@x.com>');
    expect(s.lines).toContain('RCPT TO:<reader@x.com>');
    expect(s.data).toContain(`Subject: =?UTF-8?B?${Buffer.from('ملخّصك في InfluenceOS').toString('base64')}?=`);
    expect(s.data).toContain('Content-Type: multipart/alternative');
    const [text, html] = decodeBase64Parts(s.data);
    expect(text).toBe('Hello\n.dot line\nبالعربي');
    expect(html).toBe('<p>Hello</p>');
  });

  it('uses AUTH LOGIN when that is all the server offers', async () => {
    const s = await fakeServer({ auth: 'LOGIN' });
    servers.push(s);
    await sendSmtp(
      { host: '127.0.0.1', port: s.port, secure: false, insecure: true, user: 'u', pass: 'p' },
      { from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'x' },
    );
    expect(s.lines).toContain('AUTH LOGIN');
    expect(s.lines).toContain(Buffer.from('u').toString('base64'));
  });

  it('refuses to send a password without encryption unless allowed', async () => {
    const s = await fakeServer();
    servers.push(s);
    await expect(
      sendSmtp({ host: '127.0.0.1', port: s.port, secure: false, insecure: false, user: 'u', pass: 'p' }, { from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'x' }),
    ).rejects.toThrow(/encrypted connection/);
    expect(s.lines.some((l) => l.startsWith('AUTH'))).toBe(false);
  });

  it("reports the server's reason when it refuses a recipient", async () => {
    const s = await fakeServer();
    servers.push(s);
    await expect(
      sendSmtp({ host: '127.0.0.1', port: s.port, secure: false, insecure: true }, { from: 'a@x.com', to: 'bad@x.com', subject: 'Hi', text: 'x' }),
    ).rejects.toThrow(/recipient address was refused: 550 no such user/);
  });

  it('never lets a header value start a new header', () => {
    const raw = buildMime({ from: 'a@x.com', to: 'b@x.com\r\nBcc: evil@x.com', subject: 'Hi\r\nBcc: evil@x.com', text: 'x' });
    expect(raw).not.toMatch(/\r\nBcc:/);
  });
});

describe('summary timing and rendering (P2.6)', () => {
  const kuwait = (iso: string) => new Date(`${iso}+03:00`);

  it('daily from 8:00 Kuwait; weekly on Sunday 8:00 with two days to catch up', () => {
    expect(digestPeriodStart('DAILY', kuwait('2026-10-06T07:59:00'))).toBeNull();
    expect(digestPeriodStart('DAILY', kuwait('2026-10-06T08:00:00'))?.toISOString()).toBe('2026-10-06T05:00:00.000Z');
    // 2026-10-04 is a Sunday.
    expect(digestPeriodStart('WEEKLY', kuwait('2026-10-04T09:00:00'))?.toISOString()).toBe('2026-10-04T05:00:00.000Z');
    expect(digestPeriodStart('WEEKLY', kuwait('2026-10-05T09:00:00'))?.toISOString()).toBe('2026-10-04T05:00:00.000Z');
    expect(digestPeriodStart('WEEKLY', kuwait('2026-10-08T09:00:00'))).toBeNull();
  });

  it('renders an Arabic summary right to left, with escaped names and absolute links', () => {
    const empty = { total: 0, items: [] };
    const digest: DigestDTO = {
      generatedAt: '2026-10-06T06:00:00.000Z',
      since: '2026-10-05T06:00:00.000Z',
      onlyMine: true,
      overdue: {
        total: 9,
        items: [
          {
            id: 'd1',
            link: '/campaigns/c1?tab=deliverables',
            influencerName: 'Maya <b>',
            campaignName: 'Winter',
            brandName: 'Glow',
            kind: 'REEL',
            platform: 'INSTAGRAM',
            at: '2026-10-01T09:00:00.000Z',
          },
        ],
      },
      dueSoon: empty,
      reviews: empty,
      removed: empty,
      expiringRights: empty,
      unpaid: { count: 2, totals: [{ currency: 'KWD', amount: '150.5' }] },
      isEmpty: false,
    };
    const mail = renderDigestEmail(digest, { locale: 'ar', appUrl: 'https://app.example.com/', name: 'هشام', frequency: 'DAILY' });
    expect(mail.rtl).toBe(true);
    expect(mail.subject).toMatch(/^ملخّصك في InfluenceOS — /);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('Maya &lt;b&gt;');
    expect(mail.html).not.toContain('Maya <b>');
    expect(mail.text).toContain('https://app.example.com/campaigns/c1?tab=deliverables');
    expect(mail.text).toContain('و8 غيرها');
    expect(mail.text).toContain('150.5 KWD');
  });
});
