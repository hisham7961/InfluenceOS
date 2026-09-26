import { describe, expect, it } from 'vitest';
import { checkCaption, hasDisclosure, mergeCaptionRules } from '../utils/caption-check';

describe('caption check (P3.5)', () => {
  it('finds the ad disclosure in Arabic and English, as a word only', () => {
    for (const t of [
      'روتيني الصباحي #إعلان',
      '#اعلان مع @glow',
      'Morning #ad',
      'Paid partnership with Glow',
      'اعلان مدفوع',
      '#Sponsored',
    ]) {
      expect(hasDisclosure(t)).toBe(true);
    }
    for (const t of ['#adventure time', 'road trip', 'بدون', '', null])
      expect(hasDisclosure(t)).toBe(false);
  });

  it('merges the deliverable and script tags once each, with their prefixes', () => {
    const rules = mergeCaptionRules(
      { requiredHashtags: ['GlowUp', '#غلو'], requiredMentions: ['glowkw'] },
      { hashtags: ['#glowup', '#Winter'], mentions: ['@GlowKW', '@sara'] },
      true,
    );
    expect(rules).toEqual({
      hashtags: ['#GlowUp', '#غلو', '#Winter'],
      mentions: ['@glowkw', '@sara'],
      disclosureRequired: true,
    });
  });

  it('marks what the caption has and what it is missing', () => {
    const rules = {
      hashtags: ['#GlowUp', '#غلو'],
      mentions: ['@glowkw', '@sara'],
      disclosureRequired: true,
    };
    const res = checkCaption('روتيني مع @GlowKW. #glowup #إعلان', rules);
    expect(res.hashtags).toEqual([
      { tag: '#GlowUp', present: true },
      { tag: '#غلو', present: false },
    ]);
    expect(res.mentions).toEqual([
      { handle: '@glowkw', present: true },
      { handle: '@sara', present: false },
    ]);
    expect(res.disclosure).toEqual({ required: true, present: true });
    expect(res.ok).toBe(false);
    expect(checkCaption('#GlowUp #غلو @glowkw @sara #ad', rules).ok).toBe(true);
  });

  it('matches whole tags only, and Arabic spellings of alef and ta marbuta', () => {
    const rules = { hashtags: ['#glow', '#إطلالة'], mentions: [], disclosureRequired: false };
    expect(checkCaption('#glowup #اطلاله', rules).hashtags).toEqual([
      { tag: '#glow', present: false },
      { tag: '#إطلالة', present: true },
    ]);
  });

  it('nothing required → empty, and a missing disclosure only counts when required', () => {
    expect(
      checkCaption('hello', { hashtags: [], mentions: [], disclosureRequired: false }),
    ).toMatchObject({ ok: true, empty: true });
    expect(
      checkCaption('hello', { hashtags: [], mentions: [], disclosureRequired: true }),
    ).toMatchObject({ ok: false, empty: false });
    expect(
      checkCaption(null, { hashtags: ['#a'], mentions: [], disclosureRequired: false }).ok,
    ).toBe(false);
  });
});
