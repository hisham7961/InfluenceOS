import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { ComplianceSettings } from './compliance-settings';

export const dynamic = 'force-dynamic';

/** Settings → Compliance (P3.5): the countries where creators need an advertising licence. */
export default async function ComplianceSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const [user, settings] = await Promise.all([api.auth.me(), api.licences.settings()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('compliance.title')} description={t('compliance.description')} />
      <ComplianceSettings initial={settings} canEdit={user.role === 'ADMIN'} />
    </div>
  );
}
