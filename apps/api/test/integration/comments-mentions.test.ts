import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, NoteDTO, NotificationDTO, UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-2/OI-8 — dedicated API-level coverage for the Collaboration Layer's
 * notification and pin-authorization rules (note.service.ts's
 * notifyMentionsAndReply/actorCanPin/pin), previously exercised only by a
 * Playwright E2E spec and never asserted directly against the API: a
 * mention always notifies except the mentioning actor themself; a reply
 * notifies the parent's author exactly once, deduped against an
 * overlapping mention; pin/unpin is gated to ADMIN, the campaign's own
 * owner, or the note's author; and an uploaded file attaches to a note and
 * round-trips through a subsequent read.
 */
async function createStaff(app: FastifyInstance, label: string): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `comments_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `Staff ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

/** A staff user with a given Role Profile set BEFORE first login — a
 *  profile/role PATCH after login revokes existing sessions (SEC-03), so
 *  logging in only once the profile is already set avoids that entirely. */
async function createProfiledStaff(
  app: FastifyInstance,
  admin: Record<string, string>,
  label: string,
  roleProfile: string,
): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `comments_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `Staff ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/users/${user.id}`, headers: admin, payload: { roleProfile } });
  if (patch.statusCode !== 200) throw new Error(`Failed to set roleProfile: ${patch.statusCode} ${patch.body}`);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('OI-2 — Collaboration Layer: mentions, notifications, pin authorization', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let influencerId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `Comments Creator ${Date.now()}`, countryCode: 'KW' } }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.attachment.deleteMany({ where: { note: { influencerId } } }).catch(() => undefined);
    await prisma.note.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  async function createNote(auth: Record<string, string>, payload: Record<string, unknown>): Promise<NoteDTO> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notes', headers: auth, payload: { influencerId, ...payload } });
    expect(res.statusCode).toBe(201);
    return res.json() as NoteDTO;
  }

  async function notificationsFor(auth: Record<string, string>): Promise<NotificationDTO[]> {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications?limit=50', headers: auth });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: NotificationDTO[] }).data;
  }

  it('mentioning a user creates a MENTION notification with the deep link; a self-mention is silently dropped and never self-notifies', async () => {
    const author = await createStaff(app, 'mention-author');
    const mentioned = await createStaff(app, 'mention-target');
    try {
      const before = await notificationsFor(mentioned.auth);
      const note = await createNote(author.auth, {
        body: `Hey please check this ${Date.now()}`,
        mentionedUserIds: [mentioned.userId, author.userId],
      });
      expect(note.mentions).toEqual([{ userId: mentioned.userId, name: 'Staff mention-target' }]);

      const after = await notificationsFor(mentioned.auth);
      const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0].category).toBe('MENTION');
      expect(fresh[0].targetUrl).toBe(`/influencers/${influencerId}`);

      const authorNotifications = await notificationsFor(author.auth);
      expect(authorNotifications.some((n) => n.targetUrl === `/influencers/${influencerId}` && n.category === 'MENTION')).toBe(false);
    } finally {
      await deleteUser(author.userId);
      await deleteUser(mentioned.userId);
    }
  });

  it('a reply notifies the parent author once, deduped against an overlapping mention', async () => {
    const parentAuthor = await createStaff(app, 'reply-parent');
    const replier = await createStaff(app, 'reply-child');
    try {
      const parent = await createNote(parentAuthor.auth, { body: `Parent note ${Date.now()}` });
      const before = await notificationsFor(parentAuthor.auth);

      await createNote(replier.auth, {
        body: `Reply mentioning the parent author ${Date.now()}`,
        parentId: parent.id,
        mentionedUserIds: [parentAuthor.userId],
      });

      const after = await notificationsFor(parentAuthor.auth);
      const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
      // Mentions are processed first, so the overlapping REPLY notification is
      // deduped away — exactly one notification, and it's the MENTION.
      expect(fresh).toHaveLength(1);
      expect(fresh[0].category).toBe('MENTION');
    } finally {
      await deleteUser(parentAuthor.userId);
      await deleteUser(replier.userId);
    }
  });

  it('a reply with no overlapping mention still notifies the parent author exactly once (REPLY)', async () => {
    const parentAuthor = await createStaff(app, 'reply2-parent');
    const replier = await createStaff(app, 'reply2-child');
    try {
      const parent = await createNote(parentAuthor.auth, { body: `Parent note ${Date.now()}` });
      const before = await notificationsFor(parentAuthor.auth);

      await createNote(replier.auth, { body: `A plain reply ${Date.now()}`, parentId: parent.id });

      const after = await notificationsFor(parentAuthor.auth);
      const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0].category).toBe('REPLY');
    } finally {
      await deleteUser(parentAuthor.userId);
      await deleteUser(replier.userId);
    }
  });

  it('replying to your own note never self-notifies', async () => {
    const author = await createStaff(app, 'self-reply');
    try {
      const parent = await createNote(author.auth, { body: `Own note ${Date.now()}` });
      const before = await notificationsFor(author.auth);
      await createNote(author.auth, { body: `Replying to myself ${Date.now()}`, parentId: parent.id });
      const after = await notificationsFor(author.auth);
      expect(after.length).toBe(before.length);
    } finally {
      await deleteUser(author.userId);
    }
  });

  it('an uploaded file attaches to a note and appears on a subsequent fetch of the thread', async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    const author = await createStaff(app, 'attach-author');
    try {
      const note = await createNote(author.auth, { body: `Note with an attachment ${Date.now()}` });
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
      const initiate = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: author.auth,
        payload: { fileName: 'evidence.png', mimeType: 'image/png', sizeBytes: bytes.length, target: { noteId: note.id } },
      });
      expect(initiate.statusCode).toBe(201);
      const ticket = initiate.json() as UploadTicketDTO;
      await app.inject({
        method: 'PUT',
        url: ticket.uploadUrl,
        headers: { ...author.auth, 'content-type': 'application/octet-stream' },
        payload: bytes,
      });
      const complete = await app.inject({
        method: 'POST',
        url: '/api/v1/files/complete',
        headers: author.auth,
        payload: { uploadToken: ticket.uploadToken },
      });
      expect(complete.statusCode).toBe(201);
      const attachment = complete.json() as AttachmentDTO;

      const list = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/notes`, headers: author.auth });
      expect(list.statusCode).toBe(200);
      const refreshed = (list.json() as NoteDTO[]).find((n) => n.id === note.id);
      expect(refreshed?.attachments).toEqual([
        { id: attachment.id, fileName: 'evidence.png', mimeType: 'image/png', sizeBytes: bytes.length, kind: attachment.kind },
      ]);
    } finally {
      await deleteUser(author.userId);
    }
  });

  describe('pin authorization', () => {
    let brandId: string;
    let campaignId: string;
    let owner: { userId: string; auth: Record<string, string> };

    beforeAll(async () => {
      brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `Pin Brand ${Date.now()}` } }));
      owner = await createStaff(app, 'pin-owner');
      campaignId = idOf(
        await app.inject({
          method: 'POST',
          url: '/api/v1/campaigns',
          headers: admin,
          payload: {
            brandId,
            name: `Pin Camp ${Date.now()}`,
            status: 'ACTIVE',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 30 * 864e5).toISOString(),
            ownerId: owner.userId,
          },
        }),
      );
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.note.deleteMany({ where: { campaignId } }).catch(() => undefined);
      await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(owner.userId);
    });

    async function createCampaignNote(auth: Record<string, string>): Promise<NoteDTO> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        headers: auth,
        payload: { campaignId, body: `Campaign chat ${Date.now()}` },
      });
      expect(res.statusCode).toBe(201);
      return res.json() as NoteDTO;
    }

    const pinAs = (id: string, pinned: boolean, auth: Record<string, string>) =>
      app.inject({ method: 'PATCH', url: `/api/v1/notes/${id}/pin`, headers: auth, payload: { pinned } });

    it('an ADMIN can pin and unpin any message', async () => {
      const author = await createStaff(app, 'pin-author-1');
      try {
        const note = await createCampaignNote(author.auth);
        expect((await pinAs(note.id, true, admin)).statusCode).toBe(200);
        expect((await pinAs(note.id, false, admin)).statusCode).toBe(200);
      } finally {
        await deleteUser(author.userId);
      }
    });

    it("the campaign's own owner can pin a message they did not author, within their campaign", async () => {
      const author = await createStaff(app, 'pin-author-2');
      try {
        const note = await createCampaignNote(author.auth);
        const res = await pinAs(note.id, true, owner.auth);
        expect(res.statusCode).toBe(200);
        expect((res.json() as NoteDTO).pinned).toBe(true);
      } finally {
        await deleteUser(author.userId);
      }
    });

    it('a non-owner, non-admin author can pin their own message', async () => {
      const author = await createStaff(app, 'pin-author-3');
      try {
        const note = await createCampaignNote(author.auth);
        const res = await pinAs(note.id, true, author.auth);
        expect(res.statusCode).toBe(200);
      } finally {
        await deleteUser(author.userId);
      }
    });

    it('a non-owner, non-admin, non-author user is rejected with 403', async () => {
      const author = await createStaff(app, 'pin-author-4');
      const bystander = await createStaff(app, 'pin-bystander');
      try {
        const note = await createCampaignNote(author.auth);
        const res = await pinAs(note.id, true, bystander.auth);
        expect(res.statusCode).toBe(403);
      } finally {
        await deleteUser(author.userId);
        await deleteUser(bystander.userId);
      }
    });

    // Manager Callout (Master Reconciliation pass) — a pin on PublishedContent
    // is a prominent callout every employee opening that video sees, so
    // self-authorship alone must not qualify: only ADMIN or an actor with
    // CONTENT_MANAGE may pin a content note. Distinct from the campaign-chat
    // rules above (content has no campaignId, so the owner-exception never
    // applies here either).
    describe('content pin authorization (Manager Callout)', () => {
      let contentId: string;

      beforeAll(async () => {
        contentId = idOf(
          await app.inject({
            method: 'POST',
            url: '/api/v1/content',
            headers: admin,
            payload: { url: `https://instagram.com/p/pin-callout-${Date.now()}`, influencerId },
          }),
        );
      });

      afterAll(async () => {
        const { PrismaClient } = await import('@influenceos/database');
        const prisma = new PrismaClient();
        await prisma.note.deleteMany({ where: { publishedContentId: contentId } }).catch(() => undefined);
        await prisma.publishedContent.delete({ where: { id: contentId } }).catch(() => undefined);
        await prisma.$disconnect();
      });

      async function createContentNote(auth: Record<string, string>): Promise<NoteDTO> {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/notes',
          headers: auth,
          payload: { publishedContentId: contentId, body: `Content callout ${Date.now()}` },
        });
        expect(res.statusCode).toBe(201);
        return res.json() as NoteDTO;
      }

      it('a LOGISTICS-profile actor (no CONTENT_MANAGE) cannot self-pin their own content comment', async () => {
        const staff = await createProfiledStaff(app, admin, 'content-pin-logistics', 'LOGISTICS');
        try {
          const note = await createContentNote(staff.auth);
          const res = await pinAs(note.id, true, staff.auth);
          expect(res.statusCode).toBe(403);
        } finally {
          await deleteUser(staff.userId);
        }
      });

      it('a GENERAL_MANAGER-profile actor (has CONTENT_MANAGE) can pin a content comment they did not author', async () => {
        const author = await createStaff(app, 'content-pin-author');
        const manager = await createProfiledStaff(app, admin, 'content-pin-manager', 'GENERAL_MANAGER');
        try {
          const note = await createContentNote(author.auth);
          const res = await pinAs(note.id, true, manager.auth);
          expect(res.statusCode).toBe(200);
          expect((res.json() as NoteDTO).pinned).toBe(true);
        } finally {
          await deleteUser(author.userId);
          await deleteUser(manager.userId);
        }
      });
    });
  });
});
