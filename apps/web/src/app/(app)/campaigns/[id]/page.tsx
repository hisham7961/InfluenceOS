import { notFound } from 'next/navigation';
import type { CampaignDetailDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { CampaignView } from './campaign-view';

export const dynamic = 'force-dynamic';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = getServerApi();

  // The roster, costs and scripts are asked for alongside the campaign itself
  // (P2.8); only when the address used a slug are they asked for again by id.
  const load = (campaignId: string) =>
    Promise.all([
      api.campaigns.influencers(campaignId),
      // Costs are finance data: without finance access the tab is left out.
      api.campaigns.costs(campaignId).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 403) return null;
        throw e;
      }),
      api.campaigns.scripts(campaignId),
    ]);
  const early = load(id).catch(() => null);

  let campaign: CampaignDetailDTO;
  try {
    campaign = await api.campaigns.get(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [influencers, costs, scripts] = (campaign.id === id ? await early : null) ?? (await load(campaign.id));

  return <CampaignView campaign={campaign} influencers={influencers} costs={costs} scripts={scripts} />;
}
