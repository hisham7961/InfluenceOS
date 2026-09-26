'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * What a page shows when loading it failed (the API was restarting, timed out
 * or returned an error). The session is kept — "Try again" re-renders the
 * page, which usually just works a few seconds later.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common.boundary');
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl py-16">
      <EmptyState
        icon={AlertTriangle}
        title={t('errorTitle')}
        description={t('errorBody')}
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2">
              <Button onClick={reset}>
                <RotateCw /> {t('retry')}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">{t('home')}</Link>
              </Button>
            </div>
            {error.digest ? (
              <p className="text-xs text-muted-foreground" dir="ltr">
                {t('reference', { id: error.digest })}
              </p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
