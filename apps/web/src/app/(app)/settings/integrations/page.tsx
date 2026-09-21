import { ApiError } from '@influenceos/api-client';
import type { ProviderCredentialStatusDTO } from '@influenceos/contracts';
import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { IntegrationsPanel } from './integrations-panel';
import { CredentialsCard } from './credentials-card';

export const dynamic = 'force-dynamic';

export default async function IntegrationsSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const integrations = await api.integrations.list();

  // Credentials are admin-only; non-admins simply don't see the card.
  let credentials: ProviderCredentialStatusDTO[] | null = null;
  try {
    credentials = await api.integrations.credentials();
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 403 || e.status === 401))) throw e;
  }

  return (
    <div>
      <PageHeader title={t('integrations.title')} description={t('integrations.description')} />
      <IntegrationsPanel initial={integrations} />
      {credentials ? <CredentialsCard initial={credentials} /> : null}
    </div>
  );
}
