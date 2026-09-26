import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { NotificationSettings } from './notification-settings';

export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const t = await getTranslations('settings');
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('notifications.title')} description={t('notifications.description')} />
      <NotificationSettings />
    </div>
  );
}
