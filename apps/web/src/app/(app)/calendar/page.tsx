import { PageHeader } from '@/components/common/page-header';
import { CalendarView } from './calendar-view';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Campaign milestones, deliverables and publish dates in one place."
      />
      <CalendarView />
    </div>
  );
}
