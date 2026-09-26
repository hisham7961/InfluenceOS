import { ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { AuditLogClient } from './audit-client';

export const dynamic = 'force-dynamic';

export default async function AuditLogPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');

  // Admin-gate on the current user. The audit API itself ALSO enforces ADMIN —
  // this page check is only for a friendly message, never the security boundary.
  const me = await api.auth.me();
  if (me.role !== 'ADMIN') {
    return (
      <div>
        <PageHeader title={t('audit.title')} description={t('audit.description')} />
        <EmptyState
          icon={ShieldAlert}
          title={t('audit.adminsOnly.title')}
          description={t('audit.adminsOnly.description')}
          className="py-16"
        />
      </div>
    );
  }

  const [initial, users] = await Promise.all([api.platform.audit({ limit: 50, page: 1 }), api.users.list()]);

  return (
    <div>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <AuditLogClient initial={initial} actors={users.map((u) => ({ id: u.id, name: u.name }))} />
    </div>
  );
}
