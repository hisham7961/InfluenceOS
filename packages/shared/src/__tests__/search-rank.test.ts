import { describe, expect, it } from 'vitest';
import { bestScore, scoreText } from '../utils/search-rank';

/** W3-6 — deterministic relevance scoring behind the ranked search page. */
describe('search relevance scoring', () => {
  it('ranks exact > prefix > word-boundary > substring > none', () => {
    expect(scoreText('Nike', 'nike')).toBe(100);
    expect(scoreText('Nike Middle East', 'nike')).toBe(70);
    expect(scoreText('Just Do It Nike', 'nike')).toBe(50); // token boundary
    expect(scoreText('unikelly', 'nike')).toBe(30); // substring only
    expect(scoreText('Adidas', 'nike')).toBe(0);
  });

  it('is case-insensitive and trims, and handles empty/nullish input', () => {
    expect(scoreText('  ACME  ', 'acme')).toBe(100);
    expect(scoreText(null, 'x')).toBe(0);
    expect(scoreText('acme', '')).toBe(0);
  });

  it('does not throw on regex-special needles', () => {
    expect(scoreText('a+b special', 'a+b')).toBe(70);
    expect(scoreText('nothing', '(')).toBe(0);
  });

  it('bestScore takes the strongest field match', () => {
    expect(bestScore(['Adidas', '@nike_kw', 'sportswear'], 'nike')).toBe(50);
    expect(bestScore([null, undefined, 'Nike'], 'nike')).toBe(100);
    expect(bestScore(['a', 'b'], 'z')).toBe(0);
  });
});
