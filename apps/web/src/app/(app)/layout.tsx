import { redirect } from 'next/navigation';
import { getServerApi } from '@/lib/api-server';
import { AppShell } from '@/components/shell/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const api = getServerApi();
  try {
    const [user, brands] = await Promise.all([api.auth.me(), api.brands.list()]);
    return (
      <AppShell user={user} brands={brands}>
        {children}
      </AppShell>
    );
  } catch {
    redirect('/login');
  }
}
