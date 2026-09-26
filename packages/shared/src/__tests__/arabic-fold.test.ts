import { describe, expect, it } from 'vitest';
import { foldArabic, hasArabic } from '../utils/arabic-fold';
import { scoreText } from '../utils/search-rank';

describe('foldArabic', () => {
  it('folds the spellings of one name to one form', () => {
    for (const form of ['أحمد', 'إحمد', 'آحمد', 'احمد', 'أَحْمَد', 'أحـمد']) {
      expect(foldArabic(form)).toBe('احمد');
    }
    expect(foldArabic('فاطمة')).toBe(foldArabic('فاطمه'));
    expect(foldArabic('مصطفى')).toBe(foldArabic('مصطفي'));
  });

  it('lower-cases Latin text and leaves it otherwise alone', () => {
    expect(foldArabic('Sara AHMED')).toBe('sara ahmed');
  });

  it('tells Arabic text apart', () => {
    expect(hasArabic('سارة')).toBe(true);
    expect(hasArabic('Sara 12')).toBe(false);
  });
});

describe('scoreText with Arabic', () => {
  it('scores a folded match like an exact one', () => {
    expect(scoreText('أمينة', 'امينه')).toBe(100);
    expect(scoreText('أمينة الفارسي', 'امينه')).toBe(70);
  });

  it('finds a word start inside Arabic text', () => {
    expect(scoreText('حملة إطلاق العطر', 'اطلاق')).toBe(50);
  });
});
