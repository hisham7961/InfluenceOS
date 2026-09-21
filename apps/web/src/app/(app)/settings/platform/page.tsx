import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { PlatformClient } from './platform-client';

export const dynamic = 'force-dynamic';

export default async function PlatformSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const [status, modules, features, endpoints] = await Promise.all([
    api.platform.status(),
    api.platform.modules(),
    api.platform.features(),
    api.platform.endpoints(),
  ]);

  return (
    <div>
      <PageHeader title={t('platform.title')} description={t('platform.description')} />
      <PlatformClient status={status} modules={modules} features={features} endpoints={endpoints} />
    </div>
  );
}
