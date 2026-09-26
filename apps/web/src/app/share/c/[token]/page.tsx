import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { CreatorPortalDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getPublicApi } from '@/lib/api-server';
import { CreatorPortal } from './creator-portal';

export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

// The token is the key to the page: keep it out of search engines and out of
// the Referer header when the creator follows a link from here.
export const metadata: Metadata = {
  title: 'Your tasks',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Messages = Record<string, Record<string, unknown>>;

/**
 * A creator's task link (P3.3): their part of one campaign, no account
 * needed. Opens in the link's language (the creator can switch with
 * ?lang=en|ar); every label comes from that language, not the viewer's
 * app setting.
 */
export default async function CreatorTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang } = await searchParams;
  if (!TOKEN.test(token)) notFound();
  let portal: CreatorPortalDTO;
  try {
    portal = await (await getPublicApi()).creatorLinks.portal(token);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const locale = lang === 'en' || lang === 'ar' ? lang : portal.locale;
  const all = (await getMessages({ locale })) as unknown as Messages;
  const messages = {
    campaigns: { creatorPortal: (all.campaigns as Messages).creatorPortal },
    enums: all.enums,
    common: all.common,
    serverText: all.serverText,
  };

  return (
    <NextIntlClientProvider locale={locale} messages={messages as never}>
      <main
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        lang={locale}
        className="bg-background min-h-screen"
      >
        <CreatorPortal token={token} initial={portal} locale={locale} />
      </main>
    </NextIntlClientProvider>
  );
}
