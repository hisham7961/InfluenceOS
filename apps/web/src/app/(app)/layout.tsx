import { redirect } from 'next/navigation';
import { getServerApi } from '@/lib/api-server';
import { AppShell } from '@/components/shell/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const api = getServerApi();
  try {
    const [user, brands] = await Promise.all([api.auth.me(), api.brands.list()]);
    // Maintenance banner (W4-2): reflect the real maintenanceMode setting. A
    // failure here must never block the app shell.
    const config = await api.clientConfig.get().catch(() => null);
    const maintenance = config?.maintenanceMode ? (config.maintenanceMessage ?? '') : null;
    return (
      <AppShell user={user} brands={brands} maintenance={maintenance}>
        {children}
      </AppShell>
    );
  } catch {
    // Route through a Route Handler (never straight to /login): a Server
    // Component can't clear cookies, so a stale access-token cookie would
    // survive the redirect and middleware would immediately bounce /login
    // back to /, looping forever. See api/session/expire/route.ts.
    redirect('/api/session/expire');
  }
}
