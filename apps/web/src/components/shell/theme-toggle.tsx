'use client';
import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-browser';

export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    // Fast local cache for instant SSR on the next navigation…
    document.cookie = `theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
    // …and persist to the account so it follows the user to any device. The
    // local change already applied, so a failed sync is non-blocking.
    void api.auth.updatePreferences({ theme: next ? 'dark' : 'light' }).catch(() => {});
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
      {dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
    </Button>
  );
}
