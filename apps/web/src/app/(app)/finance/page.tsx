import { getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { FinanceWorkspace } from './finance-workspace';

export const dynamic = 'force-dynamic';

/**
 * P2.3 — Finance: what is still owed to creators and suppliers (oldest due
 * first) and every payment made, with Excel exports. Only for users who may
 * see money; recording and voiding payments needs finance management.
 */
export default async function FinancePage() {
  const t = await getTranslations('finance');
  const me = await getServerApi().auth.me();
  const allowed = me.role === 'ADMIN' || !me.capabilities || me.capabilities.includes('FINANCE_VIEW');
  return (
    <div>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {allowed ? (
        <FinanceWorkspace />
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0" /> {t('noAccess')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
