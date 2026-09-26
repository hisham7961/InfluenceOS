import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { AiSettings } from './ai-settings';

export const dynamic = 'force-dynamic';

/** Settings → AI (P3.2): the switch, the Claude key and model, and the monthly limit. */
export default async function AiSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const user = await api.auth.me();
  const isAdmin = user.role === 'ADMIN';
  const [settings, status] = await Promise.all([
    isAdmin ? api.ai.settings() : Promise.resolve(null),
    api.ai.status(),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('ai.title')} description={t('ai.description')} />
      <AiSettings initial={settings} status={status} />
    </div>
  );
}
