import './globals.css';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { cookies } from 'next/headers';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import { isRtl } from '@/i18n/request';

// Fonts are downloaded at build time and served from the app itself (no
// request to Google from the browser). Inter covers Latin; Arabic text falls
// through to IBM Plex Sans Arabic instead of whatever the device happens to have.
const latin = Inter({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'InfluenceOS — Influencer Command Center',
    template: '%s · InfluenceOS',
  },
  description: 'A live influencer marketing command center for multi-brand campaign teams.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = (await cookies()).get('theme')?.value;

  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? 'rtl' : 'ltr'}
      className={[latin.variable, arabic.variable, theme === 'dark' ? 'dark' : ''].filter(Boolean).join(' ')}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
