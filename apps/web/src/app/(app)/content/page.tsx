import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { ContentWall } from './content-wall';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const api = getServerApi();
  const [feed, brands] = await Promise.all([api.content.feed({ limit: 24 }), api.brands.list()]);

  return (
    <div>
      <PageHeader
        title="Live Content"
        description="Every piece of influencer content, as it goes live across your brands."
      />
      <ContentWall initial={feed} brands={brands} />
    </div>
  );
}
