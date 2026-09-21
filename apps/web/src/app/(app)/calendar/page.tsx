import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { CalendarView } from './calendar-view';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const t = await getTranslations('reports');
  return (
    <div>
      <PageHeader title={t('calendar.title')} description={t('calendar.description')} />
      <CalendarView />
    </div>
  );
}
