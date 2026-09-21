import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, NoteDTO, UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W1-4 / SEC-04 — least-privilege delete gate. A destructive delete of a
 * user-owned record (an uploaded file, an authored note) is allowed only for
 * the owner or an ADMIN. A different STAFF user is refused with 403; the owner
 * and an ADMIN succeed. Hiding a button is not the boundary — the API enforces
 * it.
 */
async function createStaff(app: FastifyInstance, label: string): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `staff_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `Staff ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('SEC-04 — owner-or-admin delete gate', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let ownerId: string;
  let owner: Record<string, string>;
  let otherId: string;
  let other: Record<string, string>;
  let influencerId: string;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    ({ userId: ownerId, auth: owner } = await createStaff(app, 'owner'));
    ({ userId: otherId, auth: other } = await createStaff(app, 'other'));
    const inf = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: admin,
      payload: { displayName: `OwnerAuthz ${Date.now()}`, countryCode: 'KW' },
    });
    influencerId = (inf.json() as { id: string }).id;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.attachment.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma.note.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(ownerId);
    await deleteUser(otherId);
  });

  async function uploadAs(auth: Record<string, string>, name: string): Promise<AttachmentDTO> {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: name, mimeType: 'image/png', sizeBytes: bytes.length, target: { influencerId } },
    });
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    return (
      await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } })
    ).json() as AttachmentDTO;
  }

  async function createNoteAs(auth: Record<string, string>): Promise<NoteDTO> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      headers: auth,
      payload: { influencerId, body: `note ${Date.now()}` },
    });
    return res.json() as NoteDTO;
  }

  const del = (url: string, auth: Record<string, string>) => app.inject({ method: 'DELETE', url, headers: auth });

  it('a non-owner STAFF cannot delete another user’s file (403); the owner can', async () => {
    const file = await uploadAs(owner, 'owned.png');
    expect((await del(`/api/v1/files/${file.id}`, other)).statusCode).toBe(403);
    expect((await del(`/api/v1/files/${file.id}`, owner)).statusCode).toBe(204);
  });

  it('an ADMIN can delete a file owned by someone else', async () => {
    const file = await uploadAs(owner, 'owned2.png');
    expect((await del(`/api/v1/files/${file.id}`, admin)).statusCode).toBe(204);
  });

  it('a non-owner STAFF cannot delete another user’s note (403); the owner can', async () => {
    const note = await createNoteAs(owner);
    expect((await del(`/api/v1/notes/${note.id}`, other)).statusCode).toBe(403);
    expect((await del(`/api/v1/notes/${note.id}`, owner)).statusCode).toBe(204);
  });

  it('an ADMIN can delete a note authored by someone else', async () => {
    const note = await createNoteAs(owner);
    expect((await del(`/api/v1/notes/${note.id}`, admin)).statusCode).toBe(204);
  });
});
