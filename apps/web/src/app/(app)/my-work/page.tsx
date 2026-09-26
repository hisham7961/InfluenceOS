import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { MyWork } from './my-work';

export const dynamic = 'force-dynamic';

export default async function MyWorkPage() {
  const t = await getTranslations('work.myWork');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <MyWork />
    </div>
  );
}
