// Arabic-aware matching: the same name is typed several ways (أحمد / احمد,
// مريم / مريـم, فاطمة / فاطمه, مصطفى / مصطفي, with or without diacritics).
// Search folds both sides to one spelling so any of them finds the others.
// The database has the same rule as the SQL function ar_fold() (migration
// 20261007090000_arabic_search) — keep the two in step.

const MARKS = /[ً-ْـٰ]/g; // tashkeel, tatweel, dagger alef
const LETTERS: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ى: 'ي',
  ة: 'ه',
};

/** Lower-case, with Arabic spelling variants folded to one form. */
export function foldArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(MARKS, '')
    .replace(/[أإآٱىة]/g, (c) => LETTERS[c]!);
}

/** The text has Arabic letters (the only case where folding can matter). */
export function hasArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}
