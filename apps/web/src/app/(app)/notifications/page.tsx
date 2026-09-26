import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { NotificationsList } from './notifications-list';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const t = await getTranslations('notifications');
  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/settings/notifications">
              <Settings2 className="h-3.5 w-3.5" />
              {t('emailSettings')}
            </Link>
          </Button>
        }
      />
      <NotificationsList />
    </div>
  );
}
