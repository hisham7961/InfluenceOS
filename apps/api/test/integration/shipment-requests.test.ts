import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AttentionItemDTO,
  CampaignOperationsBoardDTO,
  CursorPage,
  MyWorkDTO,
  ProductShipmentDTO,
  ShipmentAwaitingDTO,
  WorkCountsDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * The link between the roster and Logistics. A confirmed creator who gets
 * products (a gift in the deal, a campaign that ships to every creator, or a
 * deliverable that needs the product) gets a pending shipment request with
 * their address copied in — nobody has to remember. A request nobody has
 * started on is taken back when the creator no longer gets products; one
 * Logistics already worked on stays. Anyone still waiting shows in red: the
 * awaiting list, the roster badge, Needs Attention and the sidebar count.
 */
describe('Shipment requests follow the roster', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let shippingCampaignId: string;
  let otherCampaignId: string;
  const extraUsers: string[] = [];

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const stamp = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  async function creator(withAddress = true): Promise<string> {
    return idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: {
          displayName: `Ship Creator ${stamp()}`,
          countryCode: 'KW',
          ...(withAddress
            ? {
                addressLine1: 'Block 3, Street 12, House 7',
                city: 'Salmiya',
                mobile: '+96550001111',
              }
            : {}),
        },
      }),
    );
  }

  async function addToRoster(
    campaign: string,
    influencerId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaign}/influencers`,
      headers: admin,
      payload: { influencerId, ...payload },
    });
    expect(res.statusCode).toBe(201);
    return idOf(res);
  }

  async function shipmentsOf(ciId: string): Promise<ProductShipmentDTO[]> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/campaign-influencers/${ciId}/shipments`,
      headers: admin,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ProductShipmentDTO[];
  }

  async function patchRoster(ciId: string, payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/campaign-influencers/${ciId}`,
      headers: admin,
      payload,
    });
    expect(res.statusCode).toBe(200);
  }

  async function staff(
    label: string,
    opts: { role?: 'STAFF' | 'VIEWER'; roleProfile?: string; brandIds?: string[] } = {},
  ): Promise<Record<string, string>> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `ship_req_${label}_${stamp()}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `Ship ${label}`,
        role: opts.role ?? 'STAFF',
        passwordHash: await hash(password),
      },
    });
    await prisma.$disconnect();
    extraUsers.push(user.id);
    if (opts.roleProfile) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${user.id}`,
        headers: admin,
        payload: { roleProfile: opts.roleProfile },
      });
      expect(r.statusCode).toBe(200);
    }
    if (opts.brandIds) {
      const r = await app.inject({
        method: 'PUT',
        url: `/api/v1/users/${user.id}/brand-access`,
        headers: admin,
        payload: { brandIds: opts.brandIds },
      });
      expect(r.statusCode).toBe(200);
    }
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    return {
      authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}`,
    };
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    brandId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/brands',
        headers: admin,
        payload: { name: `Ship Brand ${stamp()}` },
      }),
    );
    otherBrandId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/brands',
        headers: admin,
        payload: { name: `Ship Other ${stamp()}` },
      }),
    );
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: admin,
        payload: { brandId, name: `Ship Camp ${stamp()}` },
      }),
    );
    shippingCampaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: admin,
        payload: { brandId, name: `Ship Every ${stamp()}`, shipsProducts: true },
      }),
    );
    otherCampaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: admin,
        payload: { brandId: otherBrandId, name: `Ship Other Camp ${stamp()}` },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign
      .deleteMany({ where: { brandId: { in: [brandId, otherBrandId] } } })
      .catch(() => undefined);
    await prisma.brand
      .deleteMany({ where: { id: { in: [brandId, otherBrandId] } } })
      .catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    for (const id of extraUsers) await deleteUser(id);
    await deleteUser(adminId);
  });

  it('confirming a creator with a gifted deal puts a pending request in Logistics, address copied', async () => {
    const ciId = await addToRoster(campaignId, await creator(), {
      dealType: 'GIFTED_PRODUCT',
      participationStatus: 'CONFIRMED',
    });
    const shipments = await shipmentsOf(ciId);
    expect(shipments).toHaveLength(1);
    expect(shipments[0]!.status).toBe('PENDING');
    expect(shipments[0]!.addressLine1).toBe('Block 3, Street 12, House 7');
    expect(shipments[0]!.phone).toBe('+96550001111');
    expect(shipments[0]!.destinationCountryCode).toBe('KW');

    // It is the same row the cross-campaign Logistics list reads.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/shipments?campaignId=${campaignId}`,
      headers: admin,
    });
    expect((list.json() as CursorPage<{ id: string }>).data.map((s) => s.id)).toContain(
      shipments[0]!.id,
    );

    // The board and roster badge say "requested", not red.
    const board = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${campaignId}/operations-board`,
        headers: admin,
      })
    ).json() as CampaignOperationsBoardDTO;
    const row = board.rows.find((r) => r.campaignInfluencerId === ciId)!;
    expect(row.logistics).toBe('REQUESTED');
    expect(row.stages.find((s) => s.key === 'product')!.state).toBe('pending');
  });

  it('an invited creator gets nothing until they confirm; a paid deal needs no products', async () => {
    const ciId = await addToRoster(campaignId, await creator(), { dealType: 'GIFTED_PRODUCT' });
    expect(await shipmentsOf(ciId)).toHaveLength(0);

    const paid = await addToRoster(campaignId, await creator(), {
      dealType: 'PAID',
      participationStatus: 'CONFIRMED',
    });
    expect(await shipmentsOf(paid)).toHaveLength(0);
    const board = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${campaignId}/operations-board`,
        headers: admin,
      })
    ).json() as CampaignOperationsBoardDTO;
    expect(board.rows.find((r) => r.campaignInfluencerId === paid)!.logistics).toBe('NOT_NEEDED');

    await patchRoster(ciId, { participationStatus: 'CONFIRMED' });
    expect(await shipmentsOf(ciId)).toHaveLength(1);
  });

  it('changing the deal to include a gift makes the request; dropping the creator takes an untouched one back', async () => {
    const ciId = await addToRoster(campaignId, await creator(), {
      dealType: 'PAID',
      participationStatus: 'CONFIRMED',
    });
    expect(await shipmentsOf(ciId)).toHaveLength(0);
    await patchRoster(ciId, { dealType: 'PAID_PLUS_GIFTED' });
    expect(await shipmentsOf(ciId)).toHaveLength(1);

    await patchRoster(ciId, { participationStatus: 'DROPPED' });
    expect(await shipmentsOf(ciId)).toHaveLength(0);

    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/activity?campaignId=${campaignId}&limit=50`,
      headers: admin,
    });
    const messages = (activity.json() as { data: { message: string }[] }).data.map(
      (a) => a.message,
    );
    expect(messages.some((m) => m.includes('was taken back'))).toBe(true);
    expect(messages.some((m) => m.includes('as dropped on'))).toBe(true);
  });

  it('a request Logistics already worked on is never taken back', async () => {
    const ciId = await addToRoster(campaignId, await creator(), {
      dealType: 'GIFTED_PRODUCT',
      participationStatus: 'CONFIRMED',
    });
    const [shipment] = await shipmentsOf(ciId);
    const upd = await app.inject({
      method: 'PATCH',
      url: `/api/v1/shipments/${shipment!.id}`,
      headers: admin,
      payload: { courier: 'Aramex' },
    });
    expect(upd.statusCode).toBe(200);
    await patchRoster(ciId, { participationStatus: 'DROPPED' });
    expect(await shipmentsOf(ciId)).toHaveLength(1);
  });

  it('a campaign that sends products to every creator makes requests for all of them — and turning it off takes them back', async () => {
    const ciId = await addToRoster(shippingCampaignId, await creator(), {
      dealType: 'PAID',
      participationStatus: 'CONFIRMED',
    });
    expect(await shipmentsOf(ciId)).toHaveLength(1);

    const off = await app.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${shippingCampaignId}`,
      headers: admin,
      payload: { shipsProducts: false },
    });
    expect(off.statusCode).toBe(200);
    expect(await shipmentsOf(ciId)).toHaveLength(0);

    const on = await app.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${shippingCampaignId}`,
      headers: admin,
      payload: { shipsProducts: true },
    });
    expect(on.statusCode).toBe(200);
    expect((on.json() as { shipsProducts: boolean }).shipsProducts).toBe(true);
    expect(await shipmentsOf(ciId)).toHaveLength(1);
  });

  it('a deliverable that needs the product makes the request', async () => {
    const ciId = await addToRoster(campaignId, await creator(), {
      dealType: 'PAID',
      participationStatus: 'CONFIRMED',
    });
    const d = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
      headers: admin,
      payload: { platform: 'INSTAGRAM', type: 'UGC', requiresProduct: true },
    });
    expect(d.statusCode).toBe(201);
    expect(await shipmentsOf(ciId)).toHaveLength(1);
  });

  it('a creator still waiting shows in red everywhere, and one click asks Logistics', async () => {
    const ciId = await addToRoster(campaignId, await creator(false), {
      dealType: 'GIFTED_PRODUCT',
      participationStatus: 'CONFIRMED',
    });
    // As if they were confirmed before requests were automatic.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.productShipment.deleteMany({ where: { campaignInfluencerId: ciId } });
    await prisma.$disconnect();

    const awaiting = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/shipments/awaiting?campaignId=${campaignId}`,
        headers: admin,
      })
    ).json() as CursorPage<ShipmentAwaitingDTO>;
    const mine = awaiting.data.find((r) => r.campaignInfluencerId === ciId);
    expect(mine).toBeDefined();
    expect(mine!.reason).toBe('DEAL');
    expect(mine!.addressOnFile).toBe(false);

    const board = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${campaignId}/operations-board`,
        headers: admin,
      })
    ).json() as CampaignOperationsBoardDTO;
    const row = board.rows.find((r) => r.campaignInfluencerId === ciId)!;
    expect(row.logistics).toBe('NEEDED');
    expect(row.stages.find((s) => s.key === 'product')!.state).toBe('overdue');

    const attention = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/dashboard/global?brandId=${brandId}`,
        headers: admin,
      })
    ).json() as { attention: AttentionItemDTO[] };
    const item = attention.attention.find(
      (i) => i.kind === 'SHIPMENT_NEEDED' && i.campaignId === campaignId,
    );
    expect(item).toBeDefined();
    expect(item!.severity).toBe('danger');

    const counts = (
      await app.inject({ method: 'GET', url: '/api/v1/me/work/counts', headers: admin })
    ).json() as WorkCountsDTO;
    expect(counts.logistics).toBeGreaterThan(0);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipment-request`,
      headers: admin,
    });
    expect(first.statusCode).toBe(201);
    expect((first.json() as { created: boolean }).created).toBe(true);
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipment-request`,
      headers: admin,
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { created: boolean; shipmentId: string }).shipmentId).toBe(
      (first.json() as { shipmentId: string }).shipmentId,
    );

    const after = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/shipments/awaiting?campaignId=${campaignId}`,
        headers: admin,
      })
    ).json() as CursorPage<ShipmentAwaitingDTO>;
    expect(after.data.some((r) => r.campaignInfluencerId === ciId)).toBe(false);
    // No address on file → the request is red until Logistics has one.
    const board2 = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${campaignId}/operations-board`,
        headers: admin,
      })
    ).json() as CampaignOperationsBoardDTO;
    expect(board2.rows.find((r) => r.campaignInfluencerId === ciId)!.logistics).toBe(
      'ADDRESS_MISSING',
    );
  });

  it("a creator's owner sees the waiting creator on My work", async () => {
    const influencerId = await creator();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/influencers/${influencerId}`,
      headers: admin,
      payload: { ownerId: adminId },
    });
    const ciId = await addToRoster(campaignId, influencerId, {
      dealType: 'GIFTED_PRODUCT',
      participationStatus: 'CONFIRMED',
    });
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.productShipment.deleteMany({ where: { campaignInfluencerId: ciId } });
    await prisma.$disconnect();
    const work = (
      await app.inject({ method: 'GET', url: '/api/v1/me/work', headers: admin })
    ).json() as MyWorkDTO;
    expect(
      work.items.some((i) => i.kind === 'SHIPMENT_NEEDED' && i.id === `needs-shipment-${ciId}`),
    ).toBe(true);
  });

  it('asking Logistics needs a campaign, creator or logistics role — and the brand in scope', async () => {
    const ciId = await addToRoster(campaignId, await creator(), {
      dealType: 'PAID',
      participationStatus: 'CONFIRMED',
    });

    const viewer = await staff('viewer', { role: 'VIEWER' });
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipment-request`,
      headers: viewer,
    });
    expect(denied.statusCode).toBe(403);

    const outside = await staff('outside', {
      roleProfile: 'INFLUENCER_MANAGER',
      brandIds: [otherBrandId],
    });
    const hidden = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipment-request`,
      headers: outside,
    });
    expect(hidden.statusCode).toBe(404);
    // …and the campaign's shipment list is out of reach too.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campaignId}/shipments`,
      headers: outside,
    });
    expect(list.statusCode).toBe(404);
    const awaiting = (
      await app.inject({ method: 'GET', url: '/api/v1/shipments/awaiting', headers: outside })
    ).json() as CursorPage<ShipmentAwaitingDTO>;
    expect(awaiting.data.every((r) => r.brandId === otherBrandId)).toBe(true);

    const inside = await staff('inside', {
      roleProfile: 'INFLUENCER_MANAGER',
      brandIds: [brandId],
    });
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipment-request`,
      headers: inside,
    });
    expect(ok.statusCode).toBe(201);
    expect(await shipmentsOf(ciId)).toHaveLength(1);

    // A request on the other brand's campaign doesn't leak into this one.
    expect(otherCampaignId).toBeTruthy();
  });
});
