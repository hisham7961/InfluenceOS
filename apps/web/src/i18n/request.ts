import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export { isRtl } from './direction';

export default getRequestConfig(async ({ requestLocale }) => {
  // An explicit locale (e.g. `getTranslations({ locale: 'ar' })` for a client
  // report in the brand's language) wins over the viewer's own preference.
  const requested = await requestLocale;
  const store = await cookies();
  const wanted = requested === 'ar' || requested === 'en' ? requested : store.get('locale')?.value;
  const locale: Locale = wanted === 'ar' ? 'ar' : 'en';
  // messages/{locale}/index.ts merges every per-namespace message file into
  // one object — see messages/en/index.ts for the namespace list.
  const messages = (await import(`../../messages/${locale}/index`)).default;
  return { locale, messages };
});
