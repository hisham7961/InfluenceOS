import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { IntegrationsPanel } from './integrations-panel';

export const dynamic = 'force-dynamic';

export default async function IntegrationsSettingsPage() {
  const api = getServerApi();
  const integrations = await api.integrations.list();

  return (
    <div>
      <PageHeader
        title="Social Integrations"
        description="How each platform connects, and what's available today."
      />
      <IntegrationsPanel initial={integrations} />
    </div>
  );
}
