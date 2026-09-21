import { ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('users');

  let users;
  try {
    users = await api.users.list();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return (
        <div>
          <PageHeader title={t('list.title')} description={t('list.description')} />
          <EmptyState
            icon={ShieldAlert}
            title={t('list.adminsOnly.title')}
            description={t('list.adminsOnly.description')}
            className="py-16"
          />
        </div>
      );
    }
    throw e;
  }

  return (
    <div>
      <PageHeader title={t('list.title')} description={t('list.description')} />
      <UsersClient initial={users} />
    </div>
  );
}
