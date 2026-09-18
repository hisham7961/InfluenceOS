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
    redirect('/login');
  }
}
