import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import type { UploadTicketDTO } from '@influenceos/contracts';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * A creator uploads the draft file itself from their task link (no account):
 * only a photo or a video, only onto their own task, and the team then sees
 * the file on the draft. A ticket from one creator's link is useless on
 * another's, and a team upload endpoint won't take it either.
 */
describe('creator draft file upload', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let api: Awaited<ReturnType<typeof clientFor>>;
  let creator: Awaited<ReturnType<typeof clientFor>>;
  let adminAuth: Record<string, string>;
  const users: string[] = [];
  const tag = `CDU${Date.now()}`;
  let brandId: string;
  let campaignId: string;
  const people: string[] = [];
  let saraTask: string;
  let mayaTask: string;
  let saraToken: string;
  let mayaToken: string;
  const VIDEO = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypmp42'),
    Buffer.alloc(64, 1),
  ]);

  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 200;
    } catch (e) {
      if (e instanceof ApiError) return e.status;
      throw e;
    }
  };

  async function put(ticket: UploadTicketDTO, body: Buffer): Promise<number> {
    if (ticket.direct) {
      const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body });
      return res.status;
    }
    const res = await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { 'content-type': 'application/octet-stream' },
      payload: body,
    });
    return res.statusCode;
  }

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    users.push(admin.userId);
    adminAuth = admin.auth;
    api = await clientFor(app, admin.auth);
    creator = await clientFor(app, {});
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (
      await prisma.brand.create({ data: { name: `${tag} Brand`, slug: tag.toLowerCase() } })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Launch`,
          slug: `${tag.toLowerCase()}-l`,
          status: 'ACTIVE',
          draftReview: true,
        },
      })
    ).id;
    const tasks: string[] = [];
    const tokens: string[] = [];
    for (const name of ['Sara', 'Maya']) {
      const inf = await prisma.influencer.create({
        data: { displayName: `${tag} ${name}`, countryCode: 'KW' },
      });
      people.push(inf.id);
      const row = await prisma.campaignInfluencer.create({
        data: { campaignId, influencerId: inf.id, participationStatus: 'CONFIRMED' },
      });
      tasks.push(
        (
          await prisma.deliverable.create({
            data: { campaignInfluencerId: row.id, platform: 'INSTAGRAM', type: 'REEL' },
          })
        ).id,
      );
      tokens.push((await api.creatorLinks.create(row.id, {})).path.replace('/share/c/', ''));
    }
    [saraTask, mayaTask] = tasks as [string, string];
    [saraToken, mayaToken] = tokens as [string, string];
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { campaignId } });
    await prisma.attachment.deleteMany({ where: { deliverableId: { in: [saraTask, mayaTask] } } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.influencer.deleteMany({ where: { id: { in: people } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('takes only a photo or a video, on the creator’s own task', async () => {
    const meta = { fileName: 'draft.mp4', mimeType: 'video/mp4', sizeBytes: VIDEO.length };
    expect(
      await status(
        creator.creatorLinks.startUpload(saraToken, saraTask, { ...meta, mimeType: 'text/html' }),
      ),
    ).toBe(422);
    expect(
      await status(
        creator.creatorLinks.startUpload(saraToken, saraTask, { ...meta, sizeBytes: 10 ** 12 }),
      ),
    ).toBe(422);
    // Maya's task through Sara's link: not found.
    expect(await status(creator.creatorLinks.startUpload(saraToken, mayaTask, meta))).toBe(404);
  });

  it('uploads the file and sends it as the draft; the team sees the file', async () => {
    const ticket = await creator.creatorLinks.startUpload(saraToken, saraTask, {
      fileName: 'My draft.mp4',
      mimeType: 'video/mp4',
      sizeBytes: VIDEO.length,
    });
    expect(await put(ticket, VIDEO)).toBeLessThan(300);

    // Another creator's link can't use this upload.
    expect(
      await status(
        creator.creatorLinks.sendDraft(mayaToken, mayaTask, { uploadToken: ticket.uploadToken }),
      ),
    ).toBe(404);
    // Nor can the team's own upload endpoint.
    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/files/complete',
      headers: adminAuth,
      payload: { uploadToken: ticket.uploadToken },
    });
    expect(complete.statusCode).toBe(400);

    const portal = await creator.creatorLinks.sendDraft(saraToken, saraTask, {
      uploadToken: ticket.uploadToken,
      caption: 'Winter glow #ad',
    });
    const draft = portal.tasks.find((t) => t.id === saraTask)!.drafts[0]!;
    expect(draft).toMatchObject({
      fileName: 'My draft.mp4',
      assetUrl: null,
      status: 'IN_REVIEW',
      fromCreator: true,
    });

    const subs = await api.deliverables.submissions(saraTask);
    expect(subs[0]!.attachment).toMatchObject({
      fileName: 'My draft.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
    });
    expect(subs[0]!.attachment!.sizeBytes).toBe(VIDEO.length);
  });

  it('refuses a draft with neither a link nor a file', async () => {
    expect(
      await status(creator.creatorLinks.sendDraft(mayaToken, mayaTask, { caption: 'hi' })),
    ).toBe(422);
  });
});
