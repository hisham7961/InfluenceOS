import { PageHeader } from '@/components/common/page-header';
import { NotificationsList } from './notifications-list';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Alerts about content, deliverables, campaigns, and account activity across your brands."
      />
      <NotificationsList />
    </div>
  );
}
