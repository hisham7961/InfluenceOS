import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { AddInfluencerForm } from './add-influencer-form';

export const dynamic = 'force-dynamic';

export default function AddInfluencerPage() {
  return (
    <div>
      <PageHeader
        title="Add Influencer"
        description="Resolve a public profile automatically, or enter their details by hand to grow your creator network."
        actions={
          <Button variant="outline" asChild>
            <Link href="/influencers">
              <ChevronLeft className="h-4 w-4" /> Back to directory
            </Link>
          </Button>
        }
      />
      <AddInfluencerForm />
    </div>
  );
}
