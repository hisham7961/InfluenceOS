'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const t = useTranslations('ui');
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 aria-hidden className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />
      <span className="sr-only">{label ?? t('spinner.loading')}</span>
    </span>
  );
}
