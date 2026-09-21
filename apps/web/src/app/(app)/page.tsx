import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { MissionControl } from '@/components/dashboard/mission-control';
import { RefreshOnFocus } from '@/components/common/refresh-on-focus';

export const dynamic = 'force-dynamic';

export default async function MissionControlPage() {
  const api = getServerApi();
  const [data, t] = await Promise.all([api.dashboard.global(), getTranslations('dashboard')]);

  return (
    <div>
      {/* Refresh alerts / What's New when the operator returns to the tab. */}
      <RefreshOnFocus />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
      />
      <MissionControl data={data} />
    </div>
  );
}
