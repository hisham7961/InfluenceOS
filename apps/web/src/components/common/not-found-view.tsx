import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/** The "this page doesn't exist (or was deleted)" screen, in the user's language. */
export async function NotFoundView() {
  const t = await getTranslations('common.boundary');
  return (
    <div className="mx-auto max-w-xl py-16">
      <EmptyState
        icon={SearchX}
        title={t('notFoundTitle')}
        description={t('notFoundBody')}
        action={
          <Button asChild>
            <Link href="/">{t('home')}</Link>
          </Button>
        }
      />
    </div>
  );
}
