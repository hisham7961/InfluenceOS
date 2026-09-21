import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttentionItemDTO, DataQualityReportDTO, DuplicateCandidateDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-6 — Data Quality + Duplicate Detection: findings are real, brand-scoped
 * aggregate counts of rows matching a real condition (never a fabricated
 * score), and duplicate candidates carry the exact field/value that matched
 * so a human can judge for themselves. Proves both against a real,
 * intentionally-incomplete roster row and a real shared-email pair.
 */
describe('OI-6 — Data Quality + Duplicate Detection', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `DQ Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: auth,
        payload: { brandId, name: `DQ Camp ${Date.now()}`, status: 'PLANNING' },
      }),
    );

    // One roster row, deliberately missing every field the report() findings
    // check for: no social accounts, no contact info, no category, a PAID
    // deal with no agreedCost, and a deliverable with no dueDate.
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `DQ Creator ${Date.now()}`, countryCode: 'KW' } }),
    );
    const ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'PAID' },
      }),
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
      headers: auth,
      payload: { platform: 'INSTAGRAM', type: 'REEL' },
    });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('report() derives real counts of missing/incomplete data, scoped to the brand', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/report?brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const report = res.json() as DataQualityReportDTO;
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));

    expect(byId['influencer-no-social'].count).toBe(1);
    expect(byId['influencer-no-contact'].count).toBe(1);
    expect(byId['influencer-no-category'].count).toBe(1);
    // A single PAID deal with no agreedCost.
    expect(byId['paid-deal-no-cost'].count).toBe(1);
    // The campaign itself is PLANNING (an open status) with no plannedBudget.
    expect(byId['campaign-no-budget'].count).toBe(1);
    // The one deliverable created above has no dueDate and is still PLANNED (active).
    expect(byId['deliverable-no-due-date'].count).toBe(1);
  });

  it('duplicates() surfaces a real exact match on a shared email, with the matching field/value shown', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const id1 = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: 'Dup Creator One', email, countryCode: 'KW' } }),
    );
    const id2 = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: 'Dup Creator Two', email, countryCode: 'KW' } }),
    );
    // Both must join this brand's roster to be in the brand-scoped result.
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: auth,
      payload: { influencerId: id1, dealType: 'GIFTED_PRODUCT' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: auth,
      payload: { influencerId: id2, dealType: 'GIFTED_PRODUCT' },
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/duplicates?brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    const matched = candidates.filter((c) => c.influencerId === id1 || c.influencerId === id2);
    expect(matched).toHaveLength(2);
    for (const c of matched) {
      expect(c.confidence).toBe('exact');
      expect(c.reasons.some((r) => r.field === 'email' && r.value === email)).toBe(true);
    }
  });

  it('duplicates() is brand-scoped — an out-of-scope brandId yields no results, never a silent fallback to full scope', async () => {
    const otherBrandId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `DQ Other Brand ${Date.now()}` } }),
    );
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/duplicates?brandId=${otherBrandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    expect(candidates).toHaveLength(0);

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.delete({ where: { id: otherBrandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });
});

/**
 * Final Completion Pass — Data Quality Center coverage: the engaged/prospect
 * severity split on creator-completeness checks, active-shipment logistics
 * findings, and the two findings that intentionally MIRROR
 * dashboard.service.ts::attention() (never a second divergent calculation)
 * rather than duplicate its Needs Attention computation. A fresh brand keeps
 * every count exact and uncontaminated by the roster from the describe block
 * above.
 */
describe('Final Completion Pass — Data Quality Center: new checks', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let ownerlessCampaignId: string;
  let engagedId: string;
  let prospectId: string;
  let pastId: string;
  let shipmentMissingId: string;
  let shipmentCompleteId: string;
  let shipmentDeliveredId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `DQ2 Brand ${Date.now()}` } }));

    // Owned + budgeted so this roster campaign never itself counts toward
    // 'campaign-no-owner' — that finding gets its own deliberately-ownerless
    // campaign below.
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: auth,
        payload: { brandId, name: `DQ2 Camp ${Date.now()}`, status: 'ACTIVE', ownerId: userId, plannedBudget: 1000 },
      }),
    );
    ownerlessCampaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: auth,
        payload: { brandId, name: `DQ2 Ownerless Camp ${Date.now()}`, status: 'PLANNING' },
      }),
    );
    // Creating a campaign with no explicit ownerId defaults it to the actor
    // (campaign.service.ts's create()) — PATCH it to a genuinely null owner.
    await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${ownerlessCampaignId}`, headers: auth, payload: { ownerId: null } });

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();

    // Engaged (ACTIVE) creator missing country/owner/mobile — needsAttention
    // tier. countryCode is required at creation, so it's nulled directly
    // afterwards to simulate a legacy pre-requirement record.
    engagedId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `DQ2 Engaged ${Date.now()}`, countryCode: 'KW', relationshipStatus: 'ACTIVE' },
      }),
    );
    await prisma.influencer.update({ where: { id: engagedId }, data: { countryCode: null } });

    // Prospect creator missing the same three fields — incomplete tier, not
    // flagged as an error (default relationshipStatus is PROSPECT).
    prospectId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `DQ2 Prospect ${Date.now()}`, countryCode: 'KW' },
      }),
    );
    await prisma.influencer.update({ where: { id: prospectId }, data: { countryCode: null } });

    // PAST-status control — missing the exact same fields, but must count
    // toward NEITHER the engaged nor the prospect tier (the relationship is
    // over; nobody is going back to complete this profile).
    pastId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `DQ2 Past ${Date.now()}`, countryCode: 'KW', relationshipStatus: 'PAST' },
      }),
    );
    await prisma.influencer.update({ where: { id: pastId }, data: { countryCode: null } });
    await prisma.$disconnect();

    // report()/buildWhere() are brand-scoped via BrandInfluencer (never a
    // stored Influencer.brandId) — link each of the three straight to this
    // brand, same as brandInfluencerSchema's upsert endpoint.
    for (const influencerId of [engagedId, prospectId, pastId]) {
      await app.inject({ method: 'POST', url: '/api/v1/brand-influencers', headers: auth, payload: { brandId, influencerId } });
    }

    // A fully-complete creator used only to host the roster/shipments below —
    // must never itself be counted by any of the six findings above.
    const rosterInfluencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: auth,
        payload: { displayName: `DQ2 Shipment Creator ${Date.now()}`, countryCode: 'KW', ownerId: userId, mobile: '+96550000099' },
      }),
    );
    const ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId: rosterInfluencerId, dealType: 'GIFTED_PRODUCT' },
      }),
    );

    // Active (default PENDING) shipment missing address/phone/destination
    // country all at once. destinationCountryCode must be explicitly null —
    // omitting it would default to the creator's own (real) countryCode.
    shipmentMissingId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: auth,
        payload: { recipientName: 'Incomplete Recipient', destinationCountryCode: null, items: [{ productName: 'Sample Kit' }] },
      }),
    );
    // Complete active shipment — must never be counted by any of the three findings.
    shipmentCompleteId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: auth,
        payload: {
          recipientName: 'Complete Recipient',
          phone: '+96550000001',
          addressLine1: 'Street 1',
          city: 'Kuwait City',
          destinationCountryCode: 'KW',
          items: [{ productName: 'Sample Kit' }],
        },
      }),
    );
    // DELIVERED (terminal) and ALSO missing everything — proves "active" excludes it.
    shipmentDeliveredId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: auth,
        payload: { recipientName: 'Delivered Recipient', destinationCountryCode: null, status: 'DELIVERED', items: [{ productName: 'Sample Kit' }] },
      }),
    );

    // Unassigned published content (needsAttention) — the same signal
    // dashboard.service.ts::attention() reports as 'unassigned-content'.
    await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=dq2-${Date.now()}`, brandId },
    });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('splits missing-country/owner/mobile into engaged (needsAttention) vs prospect (incomplete) tiers, excluding PAST-status creators from both', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/report?brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const report = res.json() as DataQualityReportDTO;
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));

    expect(byId['influencer-engaged-no-country'].count).toBe(1);
    expect(byId['influencer-engaged-no-country'].severity).toBe('needsAttention');
    expect(byId['influencer-prospect-no-country'].count).toBe(1);
    expect(byId['influencer-prospect-no-country'].severity).toBe('incomplete');

    expect(byId['influencer-engaged-no-owner'].count).toBe(1);
    expect(byId['influencer-engaged-no-owner'].severity).toBe('needsAttention');
    expect(byId['influencer-engaged-no-owner'].fixLabel).toBe('Assign Owner');
    expect(byId['influencer-prospect-no-owner'].count).toBe(1);
    expect(byId['influencer-prospect-no-owner'].severity).toBe('incomplete');
    expect(byId['influencer-prospect-no-owner'].fixLabel).toBe('Assign Owner');

    expect(byId['influencer-engaged-no-mobile'].count).toBe(1);
    expect(byId['influencer-engaged-no-mobile'].severity).toBe('needsAttention');
    expect(byId['influencer-prospect-no-mobile'].count).toBe(1);
    expect(byId['influencer-prospect-no-mobile'].severity).toBe('incomplete');

    // The existing 'influencer-no-social' check's deep link now carries a
    // real filter param instead of the bare '/influencers'.
    expect(byId['influencer-no-social'].link).toBe('/influencers?missingSocial=true');
  });

  it('counts ACTIVE shipments missing address/phone/destination country, excluding a complete shipment and a DELIVERED one', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/report?brandId=${brandId}`, headers: auth });
    const report = res.json() as DataQualityReportDTO;
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));

    expect(byId['shipment-active-missing-address'].count).toBe(1);
    expect(byId['shipment-active-missing-address'].severity).toBe('critical');
    expect(byId['shipment-active-missing-address'].link).toBe('/logistics?missingAddress=true');

    expect(byId['shipment-active-missing-country'].count).toBe(1);
    expect(byId['shipment-active-missing-country'].severity).toBe('critical');
    expect(byId['shipment-active-missing-country'].link).toBe('/logistics?missingDestinationCountry=true');

    expect(byId['shipment-active-missing-phone'].count).toBe(1);
    expect(byId['shipment-active-missing-phone'].severity).toBe('needsAttention');
    expect(byId['shipment-active-missing-phone'].link).toBe('/logistics?missingPhone=true');
  });

  it("'campaign-no-owner' and 'content-unassigned' mirror dashboard.service.ts::attention() exactly, never a second divergent calculation", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/report?brandId=${brandId}`, headers: auth });
    const report = res.json() as DataQualityReportDTO;
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));

    expect(byId['campaign-no-owner'].count).toBe(1);
    expect(byId['content-unassigned'].count).toBe(1);

    const attentionRes = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${brandId}`, headers: auth });
    expect(attentionRes.statusCode).toBe(200);
    const attention = attentionRes.json() as AttentionItemDTO[];
    const ownerItem = attention.find((i) => i.id === 'campaigns-missing-owner');
    const contentItem = attention.find((i) => i.id === 'unassigned-content');
    expect(ownerItem?.title).toBe('1 campaign missing an owner');
    expect(contentItem?.title).toBe('1 unassigned content item');
    expect(ownerItem?.link).toBe('/campaigns?ownerMissing=1');

    // The deep link itself: /campaigns?ownerMissing=1 must return exactly the
    // campaign the finding counted, not silently no-op (it did, pre-fix).
    const deepLinkRes = await app.inject({ method: 'GET', url: `/api/v1/campaigns?brandId=${brandId}&ownerMissing=1`, headers: auth });
    expect(deepLinkRes.statusCode).toBe(200);
    const deepLinkIds = (deepLinkRes.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(deepLinkIds).toEqual([ownerlessCampaignId]);
  });

  it('the missingCountry/missingOwner/missingPhone/missingSocial influencer deep links return exactly the rows report() counted', async () => {
    const anyMissingCountry = await app.inject({ method: 'GET', url: `/api/v1/influencers?brandId=${brandId}&missingCountry=true`, headers: auth });
    const anyMissingCountryIds = (anyMissingCountry.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(anyMissingCountryIds.sort()).toEqual([engagedId, pastId, prospectId].sort());

    // The PROSPECT-scoped deep link matches its finding's exact count (1).
    const prospectMissingCountry = await app.inject({
      method: 'GET',
      url: `/api/v1/influencers?brandId=${brandId}&missingCountry=true&relationshipStatus=PROSPECT`,
      headers: auth,
    });
    const prospectMissingCountryIds = (prospectMissingCountry.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(prospectMissingCountryIds).toEqual([prospectId]);

    const missingOwner = await app.inject({ method: 'GET', url: `/api/v1/influencers?brandId=${brandId}&missingOwner=true`, headers: auth });
    const missingOwnerIds = (missingOwner.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(missingOwnerIds.sort()).toEqual([engagedId, pastId, prospectId].sort());

    const missingPhone = await app.inject({ method: 'GET', url: `/api/v1/influencers?brandId=${brandId}&missingPhone=true`, headers: auth });
    const missingPhoneIds = (missingPhone.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(missingPhoneIds.sort()).toEqual([engagedId, pastId, prospectId].sort());
  });

  it('the missingAddress/missingPhone/missingDestinationCountry shipment deep links return exactly the active shipment report() counted', async () => {
    const missingAddress = await app.inject({ method: 'GET', url: `/api/v1/shipments?brandId=${brandId}&missingAddress=true`, headers: auth });
    const missingAddressIds = (missingAddress.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(missingAddressIds).toEqual([shipmentMissingId]);
    expect(missingAddressIds).not.toContain(shipmentCompleteId);
    expect(missingAddressIds).not.toContain(shipmentDeliveredId);

    const missingDestinationCountry = await app.inject({
      method: 'GET',
      url: `/api/v1/shipments?brandId=${brandId}&missingDestinationCountry=true`,
      headers: auth,
    });
    const missingDestinationCountryIds = (missingDestinationCountry.json() as { data: { id: string }[] }).data.map((d) => d.id);
    expect(missingDestinationCountryIds).toEqual([shipmentMissingId]);
  });
});
