'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-browser';

export function LocaleToggle() {
  const locale = useLocale();
  const t = useTranslations('common');
  const [pending, setPending] = React.useState(false);

  async function toggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    setPending(true);
    // The cookie is what the next page render reads…
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    // …and the account keeps it for every device. Don't let a slow API hold
    // the switch up: the cookie alone is enough for this browser.
    await Promise.race([
      api.auth.updatePreferences({ locale: next }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    // A full reload rather than router.refresh(): every string, the page
    // direction and the fonts change, and the soft refresh was seen to stall
    // (the language never switched) in the E2E run.
    window.location.reload();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      disabled={pending}
      className="gap-1.5 font-semibold"
      aria-label={t('toggleLanguage')}
    >
      <Languages className="h-4 w-4" />
      {locale === 'ar' ? 'ع' : 'EN'}
    </Button>
  );
}
