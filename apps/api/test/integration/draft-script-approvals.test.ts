import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AttachmentDTO,
  CampaignDetailDTO,
  DeliverableSubmissionDTO,
  ScriptDTO,
  UploadTicketDTO,
} from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P2.1 — drafts and scripts go through approval for every deliverable type,
 * with the draft file and caption on the submission, and a roster row gets
 * its own files (the creator's agreement).
 *
 * - An approved Reel draft is cleared to post, not delivered: no publishedAt,
 *   progress unchanged. An approved UGC asset is delivered.
 * - A submission can only carry a file uploaded to its own deliverable (an
 *   empty one still marks a draft shared outside the app).
 * - A script version moves DRAFT → SENT_TO_BRAND → CHANGES_REQUESTED /
 *   APPROVED; the approved one is the one to follow.
 * - Files and scripts keep brand scope on read (list, get by id), and a
 *   roster row's files keep the creator's country scope.
 */
describe('P2.1 — draft and script approvals, roster files', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let scopedId: string;
  let scoped: Record<string, string>;
  let countryId: string;
  let countryScoped: Record<string, string>;
  let brandA: string;
  let brandB: string;
  let campaignA: string;
  let rosterRow: string;
  let reel: string;
  let ugc: string;
  let otherDeliverable: string;
  let influencerId: string;

  const tag = `P21-${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  async function createUser(label: string): Promise<{ userId: string; auth: Record<string, string> }> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `${tag.toLowerCase()}_${label}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: 'STAFF', passwordHash: await hash(password) },
    });
    await prisma.$disconnect();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
    const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
    return { userId: user.id, auth: { authorization: `Bearer ${tokens.accessToken}` } };
  }

  async function upload(target: Record<string, string>, name = 'draft.png'): Promise<AttachmentDTO> {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: admin,
      payload: { fileName: name, mimeType: 'image/png', sizeBytes: bytes.length, target },
    });
    expect(initiate.statusCode).toBe(201);
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...admin, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/files/complete',
      headers: admin,
      payload: { uploadToken: ticket.uploadToken },
    });
    expect(done.statusCode).toBeLessThan(300);
    return done.json() as AttachmentDTO;
  }

  async function deliverable(id: string): Promise<{ status: string; publishedAt: Date | null }> {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const row = await prisma.deliverable.findUniqueOrThrow({ where: { id }, select: { status: true, publishedAt: true } });
    await prisma.$disconnect();
    return row;
  }

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandA = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand A` } }));
    brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand B` } }));
    campaignA = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandA, name: `${tag} Camp A` } }));
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} Creator`, countryCode: 'SA' } }),
    );
    rosterRow = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: admin, payload: { influencerId, dealType: 'FREE' } }),
    );
    reel = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${rosterRow}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'REEL' } }),
    );
    ugc = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${rosterRow}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'UGC' } }),
    );
    otherDeliverable = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${rosterRow}/deliverables`, headers: admin, payload: { platform: 'TIKTOK', type: 'VIDEO' } }),
    );

    ({ userId: scopedId, auth: scoped } = await createUser('brand-b'));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${scopedId}/brand-access`, headers: admin, payload: { brandIds: [brandB] } });
    ({ userId: countryId, auth: countryScoped } = await createUser('kw-only'));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${countryId}/country-access`, headers: admin, payload: { countryCodes: ['KW'] } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(scopedId);
    await deleteUser(countryId);
    await deleteUser(adminId);
  });

  it('turns draft review on for the whole campaign', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}`, headers: admin })).json() as CampaignDetailDTO;
    expect(before.draftReview).toBe(false);
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaignA}`, headers: admin, payload: { draftReview: true } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as CampaignDetailDTO).draftReview).toBe(true);
  });

  it('keeps the draft file and caption on the submission; approving a Reel clears it to post without posting it', async () => {
    const file = await upload({ deliverableId: reel });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/deliverables/${reel}/submissions`,
      headers: admin,
      payload: { caption: 'New drop is here ✨ #ad', attachmentId: file.id },
    });
    expect(created.statusCode).toBe(201);
    const sub = created.json() as DeliverableSubmissionDTO;
    expect(sub.caption).toBe('New drop is here ✨ #ad');
    expect(sub.attachment?.id).toBe(file.id);
    expect(sub.attachment?.downloadUrl).toBeTruthy();
    expect((await deliverable(reel)).status).toBe('IN_REVIEW');

    const approved = await app.inject({ method: 'POST', url: `/api/v1/submissions/${sub.id}/review`, headers: admin, payload: { decision: 'APPROVE' } });
    expect(approved.statusCode).toBe(200);
    const after = await deliverable(reel);
    expect(after.status).toBe('APPROVED');
    expect(after.publishedAt).toBeNull();

    const campaign = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}`, headers: admin })).json() as CampaignDetailDTO;
    expect(campaign.progress.deliverablesPublished).toBe(0);
  });

  it('approving UGC delivers it', async () => {
    const sub = (
      await app.inject({ method: 'POST', url: `/api/v1/deliverables/${ugc}/submissions`, headers: admin, payload: { assetUrl: 'https://drive.example.com/ugc1' } })
    ).json() as DeliverableSubmissionDTO;
    await app.inject({ method: 'POST', url: `/api/v1/submissions/${sub.id}/review`, headers: admin, payload: { decision: 'APPROVE' } });
    const after = await deliverable(ugc);
    expect(after.status).toBe('APPROVED');
    expect(after.publishedAt).toBeTruthy();
    const campaign = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}`, headers: admin })).json() as CampaignDetailDTO;
    expect(campaign.progress.deliverablesPublished).toBe(1);
  });

  it("refuses a file from another deliverable; an empty draft (shared outside the app) is fine", async () => {
    const elsewhere = await upload({ deliverableId: otherDeliverable }, 'other.png');
    const wrongFile = await app.inject({
      method: 'POST',
      url: `/api/v1/deliverables/${reel}/submissions`,
      headers: admin,
      payload: { attachmentId: elsewhere.id },
    });
    expect(wrongFile.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: `/api/v1/deliverables/${reel}/submissions`, headers: admin, payload: {} });
    expect(empty.statusCode).toBe(201);
  });

  it('moves a script through the brand approval; the approved version is the one to follow', async () => {
    const script = (
      await app.inject({ method: 'POST', url: '/api/v1/scripts', headers: admin, payload: { campaignId: campaignA, title: `${tag} Script`, body: 'v1 body' } })
    ).json() as ScriptDTO;
    expect(script.versions[0]!.status).toBe('DRAFT');
    expect(script.approvedVersion).toBeNull();

    const status = (version: number, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/v1/scripts/${script.id}/versions/${version}/status`, headers: admin, payload });

    expect((await status(1, { status: 'SENT_TO_BRAND' })).statusCode).toBe(200);
    const changes = (await status(1, { status: 'CHANGES_REQUESTED', note: 'Say the price in the first 3 seconds' })).json() as ScriptDTO;
    const v1 = changes.versions.find((v) => v.version === 1)!;
    expect(v1.status).toBe('CHANGES_REQUESTED');
    expect(v1.reviewNote).toBe('Say the price in the first 3 seconds');
    expect(v1.reviewedByName).toBeTruthy();
    expect(v1.reviewedAt).toBeTruthy();

    await app.inject({ method: 'POST', url: `/api/v1/scripts/${script.id}/versions`, headers: admin, payload: { body: 'v2 body with price' } });
    const approved = (await status(2, { status: 'APPROVED' })).json() as ScriptDTO;
    expect(approved.approvedVersion).toBe(2);
    expect(approved.versions.find((v) => v.version === 2)!.status).toBe('APPROVED');

    // Taking approval back clears the version to follow.
    const reopened = (await status(2, { status: 'CHANGES_REQUESTED', note: 'Legal wants a new claim' })).json() as ScriptDTO;
    expect(reopened.approvedVersion).toBeNull();
    // Back to draft wipes the review stamp.
    const draft = (await status(1, { status: 'DRAFT' })).json() as ScriptDTO;
    const back = draft.versions.find((v) => v.version === 1)!;
    expect(back.status).toBe('DRAFT');
    expect(back.reviewNote).toBeNull();
    expect(back.reviewedAt).toBeNull();

    expect((await status(9, { status: 'APPROVED' })).statusCode).toBe(404);
    expect((await status(1, { status: 'NOPE' })).statusCode).toBe(422);

    // Another brand's user can neither read nor move it.
    expect((await app.inject({ method: 'GET', url: `/api/v1/scripts/${script.id}`, headers: scoped })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/scripts/${script.id}/versions/1/status`, headers: scoped, payload: { status: 'APPROVED' } }))
        .statusCode,
    ).toBe(404);
  });

  it("keeps files in brand scope on read: another brand's user can't list or open them", async () => {
    const file = await upload({ deliverableId: reel }, 'brief.png');
    const list = await app.inject({ method: 'GET', url: `/api/v1/files?deliverableId=${reel}`, headers: scoped });
    expect(list.statusCode).toBe(404);
    const byId = await app.inject({ method: 'GET', url: `/api/v1/files/${file.id}`, headers: scoped });
    expect(byId.statusCode).toBe(404);
    const campaignFiles = await app.inject({ method: 'GET', url: `/api/v1/files?campaignId=${campaignA}`, headers: scoped });
    expect(campaignFiles.statusCode).toBe(404);
    // The owner still sees it.
    const own = (await app.inject({ method: 'GET', url: `/api/v1/files?deliverableId=${reel}`, headers: admin })).json() as AttachmentDTO[];
    expect(own.some((f) => f.id === file.id)).toBe(true);
  });

  it("gives a roster row its own files, in the creator's country scope", async () => {
    const agreement = await upload({ campaignInfluencerId: rosterRow }, 'agreement.png');
    const list = (await app.inject({ method: 'GET', url: `/api/v1/files?campaignInfluencerId=${rosterRow}`, headers: admin })).json() as AttachmentDTO[];
    expect(list.map((f) => f.id)).toEqual([agreement.id]);
    // The roster row's files are not the campaign's general files.
    const campaignFiles = (await app.inject({ method: 'GET', url: `/api/v1/files?campaignId=${campaignA}`, headers: admin })).json() as AttachmentDTO[];
    expect(campaignFiles.some((f) => f.id === agreement.id)).toBe(false);

    // A KW-only user can't see a Saudi creator's agreement.
    expect((await app.inject({ method: 'GET', url: `/api/v1/files?campaignInfluencerId=${rosterRow}`, headers: countryScoped })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/files/${agreement.id}`, headers: countryScoped })).statusCode).toBe(404);
    // Nor another brand's user.
    expect((await app.inject({ method: 'GET', url: `/api/v1/files?campaignInfluencerId=${rosterRow}`, headers: scoped })).statusCode).toBe(404);
  });
});
