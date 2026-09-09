import { ShieldAlert } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage() {
  const api = getServerApi();

  let users;
  try {
    users = await api.users.list();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return (
        <div>
          <PageHeader title="Users" description="Manage teammates, roles, and access across your workspace." />
          <EmptyState
            icon={ShieldAlert}
            title="Admins only"
            description="You need administrator access to view and manage workspace users. Ask a workspace admin to grant you access."
            className="py-16"
          />
        </div>
      );
    }
    throw e;
  }

  return (
    <div>
      <PageHeader title="Users" description="Manage teammates, roles, and access across your workspace." />
      <UsersClient initial={users} />
    </div>
  );
}
