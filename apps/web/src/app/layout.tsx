import './globals.css';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { cookies } from 'next/headers';
import { Providers } from '@/components/providers';
import { isRtl } from '@/i18n/request';

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
      className={theme === 'dark' ? 'dark' : undefined}
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
