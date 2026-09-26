import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { ApprovalsList } from './approvals-list';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const t = await getTranslations('work.approvals');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <ApprovalsList />
    </div>
  );
}
