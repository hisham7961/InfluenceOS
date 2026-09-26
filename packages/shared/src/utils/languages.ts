/**
 * Languages a creator speaks (P3.7). The profile field is free text ("Arabic",
 * "english", "العربية"…), so the directory's language filter matches every
 * common spelling of the chosen language rather than one exact string.
 */
export const CREATOR_LANGUAGES = ['ar', 'en', 'fr', 'hi', 'ur', 'fa', 'tr', 'es'] as const;
export type CreatorLanguage = (typeof CREATOR_LANGUAGES)[number];

const NAMES: Record<CreatorLanguage, string[]> = {
  ar: ['Arabic', 'العربية', 'عربي', 'عربية'],
  en: ['English', 'الإنجليزية', 'الانجليزية', 'إنجليزي', 'انجليزي'],
  fr: ['French', 'Français', 'Francais', 'الفرنسية', 'فرنسي'],
  hi: ['Hindi', 'الهندية', 'هندي'],
  ur: ['Urdu', 'الأردية', 'الاردية', 'أردو', 'اردو'],
  fa: ['Persian', 'Farsi', 'الفارسية', 'فارسي'],
  tr: ['Turkish', 'Türkçe', 'Turkce', 'التركية', 'تركي'],
  es: ['Spanish', 'Español', 'Espanol', 'الإسبانية', 'الاسبانية', 'إسباني'],
};

/** Every stored spelling that means `code`: the code and names, in common letter cases. */
export function languageAliases(code: string): string[] {
  const key = code.trim().toLowerCase() as CreatorLanguage;
  const names = NAMES[key];
  if (!names) return [code];
  const out = new Set<string>();
  for (const v of [key, ...names]) {
    out.add(v);
    out.add(v.toLowerCase());
    out.add(v.toUpperCase());
    out.add(v.charAt(0).toUpperCase() + v.slice(1).toLowerCase());
  }
  return [...out];
}
