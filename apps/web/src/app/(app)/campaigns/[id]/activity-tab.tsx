'use client';

import { useTranslations } from 'next-intl';
import { ActivityFeed } from '@/components/common/activity-feed';

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function ActivityTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  return (
    <ActivityFeed
      filter={{ campaignId }}
      queryKey={['campaign-activity', campaignId]}
      emptyDescription={t('workspace.activity.emptyDescription')}
    />
  );
}
