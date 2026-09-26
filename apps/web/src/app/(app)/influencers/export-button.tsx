'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';

type ExportFilters = Record<string, string | undefined>;

/**
 * "Export CSV" download for the influencer directory. Builds a same-origin href
 * to the export endpoint (through the BFF cookie transport) carrying the current
 * directory filters, so the downloaded file mirrors exactly what the user is
 * viewing. The server sets the attachment filename via Content-Disposition.
 */
export function ExportInfluencersButton({ filters }: { filters: ExportFilters }) {
  const t = useTranslations('influencers');
  const locale = useLocale();
  const href = api.influencers.exportUrl({ ...filters, locale });
  return (
    <Button asChild variant="outline">
      <a href={href} download>
        <Download className="h-4 w-4" /> {t('directory.exportCsv')}
      </a>
    </Button>
  );
}
