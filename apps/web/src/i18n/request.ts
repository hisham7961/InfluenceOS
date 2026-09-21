import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export function isRtl(locale: string): boolean {
  return locale === 'ar';
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('locale')?.value;
  const locale: Locale = cookieLocale === 'ar' ? 'ar' : 'en';
  // messages/{locale}/index.ts merges every per-namespace message file into
  // one object — see messages/en/index.ts for the namespace list.
  const messages = (await import(`../../messages/${locale}/index`)).default;
  return { locale, messages };
});
