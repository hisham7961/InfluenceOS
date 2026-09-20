import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { ContentWall } from './content-wall';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const api = getServerApi();
  const [feed, brands, campaigns, influencers, user] = await Promise.all([
    api.content.feed({ limit: 24 }),
    api.brands.list(),
    api.campaigns.list({ pageSize: 100 }),
    api.influencers.list({ pageSize: 100 }),
    api.auth.me(),
  ]);

  return (
    <div>
      <PageHeader
        title="Live Content"
        description="Every piece of influencer content, as it goes live across your brands."
      />
      <ContentWall
        initial={feed}
        brands={brands}
        campaigns={campaigns.data}
        influencers={influencers.data}
        initialLayout={user.contentLayout}
      />
    </div>
  );
}
