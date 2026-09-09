import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { NewCampaignForm } from './new-campaign-form';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const api = getServerApi();
  const brands = await api.brands.list();

  return (
    <div>
      <PageHeader
        title="New Campaign"
        description="Set up the basics now — you can add influencers, deliverables and budget once it's live."
        actions={
          <Button variant="outline" asChild>
            <Link href="/campaigns">
              <ChevronLeft className="h-4 w-4" /> Back to campaigns
            </Link>
          </Button>
        }
      />
      <NewCampaignForm brands={brands} />
    </div>
  );
}
