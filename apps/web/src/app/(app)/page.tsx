import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { MissionControl } from '@/components/dashboard/mission-control';
import { RefreshOnFocus } from '@/components/common/refresh-on-focus';

export const dynamic = 'force-dynamic';

export default async function MissionControlPage() {
  const api = getServerApi();
  const data = await api.dashboard.global();

  return (
    <div>
      {/* Refresh alerts / What's New when the operator returns to the tab. */}
      <RefreshOnFocus />
      <PageHeader
        title="Mission Control"
        description="Everything happening across your brands, right now."
      />
      <MissionControl data={data} />
    </div>
  );
}
