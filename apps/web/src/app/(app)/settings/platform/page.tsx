import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { PlatformClient } from './platform-client';

export const dynamic = 'force-dynamic';

export default async function PlatformSettingsPage() {
  const api = getServerApi();
  const [status, modules, features, endpoints] = await Promise.all([
    api.platform.status(),
    api.platform.modules(),
    api.platform.features(),
    api.platform.endpoints(),
  ]);

  return (
    <div>
      <PageHeader
        title="Platform & API"
        description="Live system health, API surface, and mobile-readiness coverage across the InfluenceOS platform."
      />
      <PlatformClient status={status} modules={modules} features={features} endpoints={endpoints} />
    </div>
  );
}
