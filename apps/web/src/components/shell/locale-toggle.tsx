'use client';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-browser';

export function LocaleToggle() {
  const router = useRouter();
  const locale = useLocale();

  function toggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    // Fast local cache so the re-render below picks up the new locale…
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    // …and persist to the account so it follows the user to any device.
    void api.auth.updatePreferences({ locale: next }).catch(() => {});
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} className="gap-1.5 font-semibold" aria-label="Toggle language">
      <Languages className="h-4 w-4" />
      {locale === 'ar' ? 'ع' : 'EN'}
    </Button>
  );
}
