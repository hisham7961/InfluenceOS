import { describe, expect, it } from 'vitest';
import { languageAliases } from '../utils/languages';

describe('languageAliases', () => {
  it('matches the code and the usual names in any letter case', () => {
    const ar = languageAliases('ar');
    for (const v of ['ar', 'AR', 'Arabic', 'arabic', 'ARABIC', 'العربية', 'عربي'])
      expect(ar).toContain(v);
    expect(languageAliases('EN')).toContain('English');
  });
  it('falls back to the value itself for other languages', () => {
    expect(languageAliases('Tagalog')).toEqual(['Tagalog']);
  });
});
