import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { ContentWall } from './content-wall';
import { WALL_PAGE_SIZE } from './wall-constants';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const api = getServerApi();
  const t = await getTranslations('content');
  const [feed, brands, user] = await Promise.all([
    api.content.feed({ limit: WALL_PAGE_SIZE, page: 1 }),
    api.brands.list(),
    api.auth.me(),
  ]);

  return (
    <div>
      <PageHeader title={t('feed.title')} description={t('feed.description')} />
      <ContentWall
        initial={feed}
        brands={brands}
        initialLayout={user.contentLayout}
      />
    </div>
  );
}
