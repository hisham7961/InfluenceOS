import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { NotificationsList } from './notifications-list';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const t = await getTranslations('notifications');
  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <NotificationsList />
    </div>
  );
}
