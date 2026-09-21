import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { DataQualityWorkspace } from './data-quality-workspace';

export const dynamic = 'force-dynamic';

/**
 * Data Quality + Duplicate Detection (Operations Intelligence pass, PART
 * 41-48) — a checklist of real, countable data gaps and a list of possible
 * duplicate creator records, both derived at read time (see
 * data-quality.service.ts). Never a fabricated "quality score".
 */
export default async function DataQualityPage() {
  const api = getServerApi();
  const [report, duplicates, brands] = await Promise.all([
    api.dataQuality.report(),
    api.dataQuality.duplicates(),
    api.brands.list(),
  ]);

  return (
    <div>
      <PageHeader
        title="Data Quality"
        description="Missing or incomplete records and possible duplicate creators across your roster, so nothing quietly falls through the cracks."
      />
      <DataQualityWorkspace initialReport={report} initialDuplicates={duplicates} brands={brands} />
    </div>
  );
}
