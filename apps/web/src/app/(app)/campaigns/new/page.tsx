import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { NewCampaignForm } from './new-campaign-form';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const api = getServerApi();
  const brands = await api.brands.list();
  const t = await getTranslations('campaigns');

  return (
    <div>
      <PageHeader
        title={t('newForm.pageTitle')}
        description={t('newForm.pageDescription')}
        actions={
          <Button variant="outline" asChild>
            <Link href="/campaigns">
              <ChevronLeft className="rtl:-scale-x-100 h-4 w-4" /> {t('newForm.backToCampaigns')}
            </Link>
          </Button>
        }
      />
      <NewCampaignForm brands={brands} />
    </div>
  );
}
