import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ConversationUnreadDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-1b — Collaboration Layer unread counts. note.service.ts's unreadCounts()
 * (and markConversationRead()) already existed; this proves the read side
 * this session added (GET /notes/conversations/unread) actually reflects
 * real messages from a real second user, and that marking a conversation
 * read genuinely zeroes it out — not a mocked/hardcoded response.
 */
describe('OI-1b — Collaboration Layer unread counts', () => {
  let app: FastifyInstance;
  let userA: Awaited<ReturnType<typeof loginFresh>>;
  let userB: Awaited<ReturnType<typeof loginFresh>>;
  let campaignId: string;
  let brandId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    userA = await loginFresh(app);
    userB = await loginFresh(app);
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: userA.auth, payload: { name: `Unread Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: userA.auth, payload: { brandId, name: `Unread Camp ${Date.now()}` } }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userA.userId);
    await deleteUser(userB.userId);
  });

  async function unread(auth: Record<string, string>, keys: string[]): Promise<ConversationUnreadDTO[]> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/conversations/unread?keys=${keys.join(',')}`, headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json() as ConversationUnreadDTO[];
  }

  it('counts a real message from another user, then zeroes out once marked read', async () => {
    const campaignKey = `campaign:${campaignId}`;

    // Nobody has posted yet — zero for both, and no lastReadAt.
    const before = await unread(userA.auth, [campaignKey]);
    expect(before.find((c) => c.conversationKey === campaignKey)).toEqual({ conversationKey: campaignKey, unreadCount: 0, lastReadAt: null });

    // User B posts to Campaign Chat.
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      headers: userB.auth,
      payload: { campaignId, body: 'Heads up — creator asked for a deadline extension.' },
    });
    expect(postRes.statusCode).toBe(201);

    // User A sees exactly 1 unread — a real count of a real row, not a stub.
    const afterPost = await unread(userA.auth, [campaignKey]);
    expect(afterPost.find((c) => c.conversationKey === campaignKey)?.unreadCount).toBe(1);

    // A message the same user authored never counts as their own unread.
    const bOwnView = await unread(userB.auth, [campaignKey]);
    expect(bOwnView.find((c) => c.conversationKey === campaignKey)?.unreadCount).toBe(0);

    // User A marks it read; the count drops to 0 and lastReadAt is now set.
    const readRes = await app.inject({ method: 'POST', url: '/api/v1/notes/conversations/read', headers: userA.auth, payload: { conversationKey: campaignKey } });
    expect(readRes.statusCode).toBe(200);

    const afterRead = await unread(userA.auth, [campaignKey]);
    const summary = afterRead.find((c) => c.conversationKey === campaignKey);
    expect(summary?.unreadCount).toBe(0);
    expect(summary?.lastReadAt).not.toBeNull();

    // A further message from B bumps it back to 1, proving the read state
    // is a real timestamp cursor, not a one-time "already seen" flag.
    await app.inject({ method: 'POST', url: '/api/v1/notes', headers: userB.auth, payload: { campaignId, body: 'Second message.' } });
    const afterSecond = await unread(userA.auth, [campaignKey]);
    expect(afterSecond.find((c) => c.conversationKey === campaignKey)?.unreadCount).toBe(1);
  });

  it('scopes counts independently per conversation key and ignores an unrecognized key', async () => {
    const results = await unread(userA.auth, ['channel:general', `campaign:${campaignId}`, 'not-a-real-key']);
    expect(results.find((c) => c.conversationKey === 'not-a-real-key')).toBeUndefined();
    expect(results.some((c) => c.conversationKey === 'channel:general')).toBe(true);
    expect(results.some((c) => c.conversationKey === `campaign:${campaignId}`)).toBe(true);
  });
});
