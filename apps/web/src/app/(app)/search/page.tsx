import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { SearchResults } from './search-results';

export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  const t = await getTranslations('search');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <SearchResults />
    </div>
  );
}
