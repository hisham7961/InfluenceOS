'use client';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LocaleToggle() {
  const router = useRouter();
  const locale = useLocale();

  function toggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} className="gap-1.5 font-semibold" aria-label="Toggle language">
      <Languages className="h-4 w-4" />
      {locale === 'ar' ? 'ع' : 'EN'}
    </Button>
  );
}
