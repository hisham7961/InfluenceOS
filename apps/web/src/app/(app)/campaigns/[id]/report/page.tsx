import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { CampaignReportDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { ClientReport } from '@/components/reports/client-report';
import { ReportToolbar } from './report-toolbar';

export const dynamic = 'force-dynamic';

/**
 * The campaign's client report (P2.2): what was promised against what was
 * delivered, per creator and per post, in the language the brand reads
 * (independent of the viewer's own). Prints cleanly to PDF from the browser
 * (the app's menus hide themselves when printing); the same figures download
 * as an Excel workbook.
 */
export default async function CampaignReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string; costs?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const api = getServerApi();
  let report: CampaignReportDTO;
  try {
    report = await api.campaigns.report(id, {
      locale: sp.lang === 'ar' || sp.lang === 'en' ? sp.lang : undefined,
      costs: sp.costs === '0' ? false : undefined,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const locale = report.locale;
  const t = await getTranslations({ locale, namespace: 'campaigns.clientReport' });
  const c = report.campaign;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ReportToolbar
        campaignId={c.id}
        locale={locale}
        costsRequested={sp.costs !== '0'}
        includeCosts={report.includeCosts}
      />

      <ClientReport report={report} />

      <p className="text-muted-foreground text-center text-xs print:hidden">
        <Link href={`/campaigns/${c.id}`} className="hover:underline">
          {t('back')}
        </Link>
      </p>
    </div>
  );
}
