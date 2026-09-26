'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, FileSpreadsheet, Printer } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { ShareReportButton } from './share-dialog';

/**
 * The report's controls, in the viewer's own language: which language the
 * report is in, whether it shows costs, print / save as PDF, and the Excel
 * download, and sharing by link. Hidden when printing.
 *
 * Switching language or costs reloads the page instead of a client-side
 * transition: the report is a standalone document, and a search-param-only
 * soft navigation can stall in the app router (observed with Next 15.5).
 */
export function ReportToolbar({
  campaignId,
  locale,
  costsRequested,
  includeCosts,
}: {
  campaignId: string;
  locale: 'en' | 'ar';
  costsRequested: boolean;
  /** False when costs were asked for but this user may not see money. */
  includeCosts: boolean;
}) {
  const t = useTranslations('campaigns.clientReport');
  const href = (next: { lang?: 'en' | 'ar'; costs?: boolean }) => {
    const q = new URLSearchParams();
    q.set('lang', next.lang ?? locale);
    if (!(next.costs ?? costsRequested)) q.set('costs', '0');
    return `/campaigns/${campaignId}/report?${q.toString()}`;
  };
  const excel = api.campaigns.reportXlsxUrl(campaignId, { locale, costs: costsRequested });
  const noFinance = costsRequested && !includeCosts;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        href={`/campaigns/${campaignId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t('back')}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t('languageLabel')}
          className="border-border inline-flex rounded-lg border p-0.5"
        >
          {(['en', 'ar'] as const).map((l) => (
            <a
              key={l}
              href={href({ lang: l })}
              aria-current={l === locale ? 'true' : undefined}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                l === locale
                  ? 'bg-brand text-white'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l === 'en' ? 'English' : 'العربية'}
            </a>
          ))}
        </div>
        <label
          className={cn(
            'border-border flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm',
            noFinance && 'opacity-60',
          )}
          title={noFinance ? t('costsNotAllowed') : undefined}
        >
          {t('includeCosts')}
          <Switch
            checked={includeCosts}
            disabled={noFinance}
            onCheckedChange={(v) => window.location.assign(href({ costs: v }))}
            aria-label={t('includeCosts')}
          />
        </label>
        <Button variant="outline" size="sm" asChild>
          <a href={excel} download>
            <FileSpreadsheet className="h-4 w-4" /> {t('downloadExcel')}
          </a>
        </Button>
        <ShareReportButton campaignId={campaignId} locale={locale} />
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t('print')}
        </Button>
      </div>
    </div>
  );
}
