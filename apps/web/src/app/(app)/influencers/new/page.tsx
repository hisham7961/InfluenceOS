import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { AddInfluencerForm } from './add-influencer-form';

export const dynamic = 'force-dynamic';

export default async function AddInfluencerPage() {
  const t = await getTranslations('influencers');
  return (
    <div>
      <PageHeader
        title={t('form.addPageTitle')}
        description={t('form.addPageDescription')}
        actions={
          <Button variant="outline" asChild>
            <Link href="/influencers">
              <ChevronLeft className="h-4 w-4" /> {t('form.backToDirectory')}
            </Link>
          </Button>
        }
      />
      <AddInfluencerForm />
    </div>
  );
}
