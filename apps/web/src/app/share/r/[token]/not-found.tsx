import { getTranslations } from 'next-intl/server';

/** A shared report link that is unknown, expired or turned off. Both languages: we don't know the reader's. */
export default async function SharedReportGone() {
  const [en, ar] = await Promise.all([
    getTranslations({ locale: 'en', namespace: 'campaigns.clientReport.shared' }),
    getTranslations({ locale: 'ar', namespace: 'campaigns.clientReport.shared' }),
  ]);
  return (
    <main className="bg-background grid min-h-screen place-items-center px-4 text-center">
      <div className="max-w-md space-y-6">
        <div lang="en" dir="ltr" className="space-y-1">
          <h1 className="text-lg font-semibold">{en('goneTitle')}</h1>
          <p className="text-muted-foreground text-sm">{en('goneBody')}</p>
        </div>
        <div lang="ar" dir="rtl" className="space-y-1">
          <h2 className="text-lg font-semibold">{ar('goneTitle')}</h2>
          <p className="text-muted-foreground text-sm">{ar('goneBody')}</p>
        </div>
      </div>
    </main>
  );
}
