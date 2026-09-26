import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { CampaignReportDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getPublicApi } from '@/lib/api-server';
import { ClientReport } from '@/components/reports/client-report';
import { ShareActions } from './share-actions';

export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

// The token is the key to the report: keep it out of search engines and out
// of the Referer header when someone follows a post link.
export const metadata: Metadata = {
  title: 'Campaign report',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

async function load(token: string): Promise<CampaignReportDTO> {
  if (!TOKEN.test(token)) notFound();
  try {
    return await (await getPublicApi()).campaigns.sharedReport(token);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

/**
 * A client report shared by link (P3.3): no sign-in, no app menus. The
 * link decides the language and whether costs show; the numbers are live.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await load(token);
  const t = await getTranslations({ locale: report.locale, namespace: 'campaigns.clientReport' });

  return (
    <main
      dir={report.locale === 'ar' ? 'rtl' : 'ltr'}
      lang={report.locale}
      className="bg-background min-h-screen px-4 py-6 sm:py-10"
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <ShareActions
          excelHref={`/share/r/${token}/excel`}
          printLabel={t('print')}
          excelLabel={t('downloadExcel')}
        />
        <ClientReport report={report} />
        <p className="text-muted-foreground text-center text-xs print:hidden">
          {t('shared.sharedNote')}
        </p>
      </div>
    </main>
  );
}
