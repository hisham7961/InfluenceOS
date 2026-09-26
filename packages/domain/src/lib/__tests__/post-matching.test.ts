import { describe, expect, it } from 'vitest';
import { matchPost, type MatchCampaign } from '../post-matching';

const now = new Date('2026-10-01T12:00:00Z');
const d = (s: string) => new Date(s);

function campaign(over: Partial<MatchCampaign> = {}): MatchCampaign {
  return {
    campaignId: 'c1',
    campaignInfluencerId: 'ci1',
    brandName: 'Lumière',
    startDate: d('2026-09-10T00:00:00Z'),
    endDate: d('2026-10-15T00:00:00Z'),
    joinedAt: d('2026-09-01T00:00:00Z'),
    codes: ['SARA15'],
    deliverables: [
      { id: 'reel', platform: 'INSTAGRAM', status: 'PLANNED', dueDate: d('2026-09-25T00:00:00Z'), requiredHashtags: ['LumiereGlow'], requiredMentions: ['lumiere.kw'] },
      { id: 'story', platform: 'INSTAGRAM', status: 'PLANNED', dueDate: d('2026-09-20T00:00:00Z'), requiredHashtags: [], requiredMentions: [] },
      { id: 'yt', platform: 'YOUTUBE', status: 'PLANNED', dueDate: null, requiredHashtags: [], requiredMentions: [] },
    ],
    ...over,
  };
}

const post = (caption: string | null, postedAt = '2026-09-22T10:00:00Z', platform = 'INSTAGRAM') => ({
  platform,
  caption,
  postedAt: postedAt ? d(postedAt) : null,
});

describe('post discovery matching (P3.4)', () => {
  it('matches by code, hashtag and mention, and picks the deliverable whose tags matched', () => {
    const m = matchPost(post('New serum ✨ #LumiereGlow @lumiere.kw code SARA15'), [campaign()], now);
    expect(m).toMatchObject({ campaignId: 'c1', deliverableId: 'reel', score: 7 });
    expect(m?.signals).toEqual(['code:SARA15', 'hashtag:#lumiereglow', 'mention:@lumiere.kw']);
  });

  it('with only a code, suggests the open deliverable due soonest on that platform', () => {
    expect(matchPost(post('use sara15 at checkout'), [campaign()], now)).toMatchObject({ deliverableId: 'story', signals: ['code:SARA15'] });
    expect(matchPost(post('Code: SARA15', '2026-09-22T10:00:00Z', 'YOUTUBE'), [campaign()], now)?.deliverableId).toBe('yt');
    expect(matchPost(post('SARA15', '2026-09-22T10:00:00Z', 'TIKTOK'), [campaign()], now)?.deliverableId).toBeNull();
  });

  it('whole tokens only; Arabic hashtags work; the brand name counts', () => {
    expect(matchPost(post('#LumiereGlowUp'), [campaign()], now)).toBeNull();
    expect(matchPost(post('mySARA150'), [campaign()], now)).toBeNull();
    const ar = campaign({ deliverables: [{ id: 'r', platform: 'INSTAGRAM', status: 'PLANNED', dueDate: null, requiredHashtags: ['#لوميير'], requiredMentions: [] }] });
    expect(matchPost(post('جربت السيروم #لوميير!'), [ar], now)?.signals).toEqual(['hashtag:#لوميير']);
    expect(matchPost(post('Loving my Lumière routine'), [campaign()], now)?.signals).toEqual(['brand']);
  });

  it('a disclosure alone counts only when the creator has one running campaign', () => {
    expect(matchPost(post('Morning routine #ad'), [campaign()], now)?.signals).toEqual(['disclosure']);
    expect(matchPost(post('صباح الخير #إعلان'), [campaign()], now)?.signals).toEqual(['disclosure']);
    const other = campaign({ campaignId: 'c2', campaignInfluencerId: 'ci2', brandName: 'Other', codes: [] });
    expect(matchPost(post('Morning routine #ad'), [campaign(), other], now)).toBeNull();
  });

  it('ignores posts outside the campaign window, empty captions, and finished deliverables', () => {
    expect(matchPost(post('SARA15', '2026-09-01T00:00:00Z'), [campaign()], now)).toBeNull();
    expect(matchPost(post('SARA15', '2026-10-20T00:00:00Z'), [campaign()], now)).toBeNull();
    expect(matchPost(post('SARA15', '2026-10-17T00:00:00Z'), [campaign()], now)).not.toBeNull();
    expect(matchPost(post(null), [campaign()], now)).toBeNull();
    const done = campaign({ deliverables: campaign().deliverables.map((x) => ({ ...x, status: 'PUBLISHED' })) });
    expect(matchPost(post('SARA15'), [done], now)).toMatchObject({ deliverableId: null });
  });

  it('picks the campaign with the most signals', () => {
    const a = campaign({ campaignId: 'a', campaignInfluencerId: 'ci-a', codes: ['AAA'] });
    const b = campaign({ campaignId: 'b', campaignInfluencerId: 'ci-b', brandName: 'Bloom', codes: ['BBB'] });
    expect(matchPost(post('AAA and BBB with Bloom'), [a, b], now)?.campaignId).toBe('b');
  });
});
