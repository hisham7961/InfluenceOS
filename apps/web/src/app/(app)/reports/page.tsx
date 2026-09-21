import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { ReportsView } from './reports-view';
import { REPORT_TYPES, type ReportType } from './reports-types';

export const dynamic = 'force-dynamic';

type Filters = Record<string, string | undefined>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const sp = await searchParams;
  const type: ReportType = (REPORT_TYPES as readonly string[]).includes(sp.type ?? '')
    ? (sp.type as ReportType)
    : 'campaign';
  const brandId = sp.brandId || undefined;
  const from = sp.from || undefined;
  const to = sp.to || undefined;

  const t = await getTranslations('reports');
  const api = getServerApi();
  const [report, brands] = await Promise.all([
    api.reports.generate({ type, brandId, from, to }),
    api.brands.list(),
  ]);

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <ReportsView initial={report} brands={brands} type={type} brandId={brandId} from={from} to={to} />
    </div>
  );
}
