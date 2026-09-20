import { describe, expect, it } from 'vitest';
import { resolveContentAssociation, contentAssociationStatus } from '../content-association';

/**
 * Pure-logic tests against a tiny in-memory mock of the four models the
 * resolver reads — no database required. Fixtures form one consistent chain:
 *   brand-1 -> campaign-1 -> ci-1 (campaign-1 + influencer-1) -> deliverable-1
 * plus a second, unrelated chain (brand-2/campaign-2/ci-2/influencer-2/deliverable-2)
 * used to construct deliberate conflicts (SCENARIO F/E style).
 */
function mockDb() {
  const deliverables: Record<string, { id: string; campaignInfluencerId: string }> = {
    'deliverable-1': { id: 'deliverable-1', campaignInfluencerId: 'ci-1' },
    'deliverable-2': { id: 'deliverable-2', campaignInfluencerId: 'ci-2' },
  };
  const campaignInfluencers: Record<string, { id: string; campaignId: string; influencerId: string }> = {
    'ci-1': { id: 'ci-1', campaignId: 'campaign-1', influencerId: 'influencer-1' },
    'ci-2': { id: 'ci-2', campaignId: 'campaign-2', influencerId: 'influencer-2' },
  };
  const campaigns: Record<string, { id: string; brandId: string }> = {
    'campaign-1': { id: 'campaign-1', brandId: 'brand-1' },
    'campaign-2': { id: 'campaign-2', brandId: 'brand-2' },
  };
  const influencers = new Set(['influencer-1', 'influencer-2']);
  const brands = new Set(['brand-1', 'brand-2']);
  const pairIndex = new Map(Object.values(campaignInfluencers).map((ci) => [`${ci.campaignId}:${ci.influencerId}`, ci]));

  return {
    deliverable: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => {
        const d = deliverables[id];
        if (!d) return null;
        const ci = campaignInfluencers[d.campaignInfluencerId];
        if (!ci) return null;
        return { id: d.id, campaignInfluencer: { ...ci, campaign: campaigns[ci.campaignId] } };
      },
    },
    campaignInfluencer: {
      findUnique: async ({ where }: { where: { id?: string; campaignId_influencerId?: { campaignId: string; influencerId: string } } }) => {
        const ci = where.id
          ? campaignInfluencers[where.id]
          : where.campaignId_influencerId
            ? pairIndex.get(`${where.campaignId_influencerId.campaignId}:${where.campaignId_influencerId.influencerId}`)
            : undefined;
        if (!ci) return null;
        return { ...ci, campaign: campaigns[ci.campaignId] };
      },
    },
    campaign: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => (campaigns[id] ? { brandId: campaigns[id].brandId } : null),
    },
    influencer: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => (influencers.has(id) ? { id } : null),
    },
    brand: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => (brands.has(id) ? { id } : null),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('resolveContentAssociation', () => {
  it('fully unassigned: no input at all resolves to all-null (Critical Question 2)', async () => {
    const r = await resolveContentAssociation(mockDb(), {});
    expect(r).toEqual({ brandId: null, campaignId: null, influencerId: null, campaignInfluencerId: null, deliverableId: null });
  });

  it('influencer-only: passes through with no campaign (Critical Question 1)', async () => {
    const r = await resolveContentAssociation(mockDb(), { influencerId: 'influencer-1' });
    expect(r).toEqual({ brandId: null, campaignId: null, influencerId: 'influencer-1', campaignInfluencerId: null, deliverableId: null });
  });

  it('influencer-only: rejects a non-existent influencer', async () => {
    await expect(resolveContentAssociation(mockDb(), { influencerId: 'ghost' })).rejects.toThrow();
  });

  it('campaign-only: derives brandId from the campaign', async () => {
    const r = await resolveContentAssociation(mockDb(), { campaignId: 'campaign-1' });
    expect(r).toEqual({ brandId: 'brand-1', campaignId: 'campaign-1', influencerId: null, campaignInfluencerId: null, deliverableId: null });
  });

  it('campaign + influencer on the roster together: derives campaignInfluencerId + brand (SCENARIO E, valid case)', async () => {
    const r = await resolveContentAssociation(mockDb(), { campaignId: 'campaign-1', influencerId: 'influencer-1' });
    expect(r).toEqual({ brandId: 'brand-1', campaignId: 'campaign-1', influencerId: 'influencer-1', campaignInfluencerId: 'ci-1', deliverableId: null });
  });

  it('campaign + influencer NOT on the roster together: rejects, does not silently mismatch (SCENARIO E, invalid case)', async () => {
    await expect(
      resolveContentAssociation(mockDb(), { campaignId: 'campaign-1', influencerId: 'influencer-2' }),
    ).rejects.toThrow(/roster/);
  });

  it('deliverable given: derives the whole chain (SCENARIO C)', async () => {
    const r = await resolveContentAssociation(mockDb(), { deliverableId: 'deliverable-1' });
    expect(r).toEqual({
      brandId: 'brand-1',
      campaignId: 'campaign-1',
      influencerId: 'influencer-1',
      campaignInfluencerId: 'ci-1',
      deliverableId: 'deliverable-1',
    });
  });

  it('deliverable given with a conflicting explicit influencer: rejects (SCENARIO F)', async () => {
    await expect(
      resolveContentAssociation(mockDb(), { deliverableId: 'deliverable-1', influencerId: 'influencer-2' }),
    ).rejects.toThrow(/does not match/);
  });

  it('deliverable given with a conflicting explicit campaign: rejects (SCENARIO F)', async () => {
    await expect(
      resolveContentAssociation(mockDb(), { deliverableId: 'deliverable-1', campaignId: 'campaign-2' }),
    ).rejects.toThrow(/does not match/);
  });

  it('deliverable given with a MATCHING explicit campaign/influencer: succeeds (redundant but consistent input is fine)', async () => {
    const r = await resolveContentAssociation(mockDb(), {
      deliverableId: 'deliverable-1',
      campaignId: 'campaign-1',
      influencerId: 'influencer-1',
    });
    expect(r.campaignInfluencerId).toBe('ci-1');
  });

  it('non-existent deliverable: rejects', async () => {
    await expect(resolveContentAssociation(mockDb(), { deliverableId: 'ghost' })).rejects.toThrow();
  });

  it('campaignInfluencerId given directly: derives the chain', async () => {
    const r = await resolveContentAssociation(mockDb(), { campaignInfluencerId: 'ci-1' });
    expect(r).toEqual({
      brandId: 'brand-1',
      campaignId: 'campaign-1',
      influencerId: 'influencer-1',
      campaignInfluencerId: 'ci-1',
      deliverableId: null,
    });
  });

  it('campaignInfluencerId given with a conflicting influencer: rejects', async () => {
    await expect(
      resolveContentAssociation(mockDb(), { campaignInfluencerId: 'ci-1', influencerId: 'influencer-2' }),
    ).rejects.toThrow(/does not match/);
  });

  it('brandId only (no campaign): passes through, existence-checked', async () => {
    const r = await resolveContentAssociation(mockDb(), { brandId: 'brand-1' });
    expect(r).toEqual({ brandId: 'brand-1', campaignId: null, influencerId: null, campaignInfluencerId: null, deliverableId: null });
    await expect(resolveContentAssociation(mockDb(), { brandId: 'ghost-brand' })).rejects.toThrow();
  });

  it('brandId conflicting with the supplied campaign\'s own brand: rejects', async () => {
    await expect(
      resolveContentAssociation(mockDb(), { campaignId: 'campaign-1', brandId: 'brand-2' }),
    ).rejects.toThrow(/does not match/);
  });

  describe('brand-scope enforcement (WORKFLOW_GAP_MATRIX.md, Permissions/privacy)', () => {
    it('unscoped (scope=null): any brand resolves fine', async () => {
      const r = await resolveContentAssociation(mockDb(), { campaignId: 'campaign-1' }, null);
      expect(r.brandId).toBe('brand-1');
    });

    it('scoped to the resolved brand: succeeds', async () => {
      const r = await resolveContentAssociation(mockDb(), { campaignId: 'campaign-1' }, ['brand-1']);
      expect(r.brandId).toBe('brand-1');
    });

    it('scoped to a DIFFERENT brand: rejects rather than silently crossing scope', async () => {
      await expect(resolveContentAssociation(mockDb(), { campaignId: 'campaign-1' }, ['brand-2'])).rejects.toThrow(
        /access/,
      );
    });

    it('scoped, via deliverable anchor: also enforced', async () => {
      await expect(
        resolveContentAssociation(mockDb(), { deliverableId: 'deliverable-1' }, ['brand-2']),
      ).rejects.toThrow(/access/);
      const r = await resolveContentAssociation(mockDb(), { deliverableId: 'deliverable-1' }, ['brand-1']);
      expect(r.brandId).toBe('brand-1');
    });

    it('scoped, fully unassigned (no brand at all): allowed — scope only blocks a KNOWN out-of-scope brand', async () => {
      const r = await resolveContentAssociation(mockDb(), {}, ['brand-1']);
      expect(r).toEqual({ brandId: null, campaignId: null, influencerId: null, campaignInfluencerId: null, deliverableId: null });
    });
  });
});

describe('contentAssociationStatus', () => {
  it('derives FULLY_LINKED / CAMPAIGN_LINKED / INFLUENCER_LINKED / UNASSIGNED from presence, not a stored enum', () => {
    expect(contentAssociationStatus({ campaignId: 'c', influencerId: 'i' })).toBe('FULLY_LINKED');
    expect(contentAssociationStatus({ campaignId: 'c', influencerId: null })).toBe('CAMPAIGN_LINKED');
    expect(contentAssociationStatus({ campaignId: null, influencerId: 'i' })).toBe('INFLUENCER_LINKED');
    expect(contentAssociationStatus({ campaignId: null, influencerId: null })).toBe('UNASSIGNED');
  });
});
