import { getTranslations } from 'next-intl/server';

/** A task link that is unknown, expired, turned off, or for a creator no longer on the campaign. Both languages. */
export default async function CreatorLinkGone() {
  const [en, ar] = await Promise.all([
    getTranslations({ locale: 'en', namespace: 'campaigns.creatorPortal' }),
    getTranslations({ locale: 'ar', namespace: 'campaigns.creatorPortal' }),
  ]);
  return (
    <main className="bg-background grid min-h-screen place-items-center px-4 text-center">
      <div className="max-w-md space-y-6">
        <div lang="ar" dir="rtl" className="space-y-1">
          <h1 className="text-lg font-semibold">{ar('goneTitle')}</h1>
          <p className="text-muted-foreground text-sm">{ar('goneBody')}</p>
        </div>
        <div lang="en" dir="ltr" className="space-y-1">
          <h2 className="text-lg font-semibold">{en('goneTitle')}</h2>
          <p className="text-muted-foreground text-sm">{en('goneBody')}</p>
        </div>
      </div>
    </main>
  );
}
