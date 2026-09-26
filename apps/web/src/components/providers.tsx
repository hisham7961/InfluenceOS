'use client';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { Toaster } from 'sonner';
import { isRtl } from '@/i18n/direction';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: React.ReactNode }) {
  // Toasts sit at the reading end of the top bar (top-left in Arabic).
  const rtl = isRtl(useLocale());
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Refresh when the operator returns to the tab so views reflect
            // background worker/provider changes without manual reload. The 30s
            // staleTime keeps this from refetching on every focus.
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      <Toaster
        position={rtl ? 'top-left' : 'top-right'}
        dir={rtl ? 'rtl' : 'ltr'}
        toastOptions={{
          classNames: {
            toast: 'rounded-xl border border-border bg-card text-foreground shadow-pop',
          },
        }}
      />
    </QueryClientProvider>
  );
}
