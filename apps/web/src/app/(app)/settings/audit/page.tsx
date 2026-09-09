import { ShieldAlert } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { AuditLogClient } from './audit-client';

export const dynamic = 'force-dynamic';

export default async function AuditLogPage() {
  const api = getServerApi();

  // Admin-gate on the current user. The audit API itself ALSO enforces ADMIN —
  // this page check is only for a friendly message, never the security boundary.
  const me = await api.auth.me();
  if (me.role !== 'ADMIN') {
    return (
      <div>
        <PageHeader title="Audit Log" description="A chronological record of actions across the workspace." />
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="You need administrator access to view the workspace audit log."
          className="py-16"
        />
      </div>
    );
  }

  const [initial, users] = await Promise.all([api.platform.audit({ limit: 50 }), api.users.list()]);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="A chronological, workspace-wide record of who did what and when — filterable and searchable."
      />
      <AuditLogClient initial={initial} actors={users.map((u) => ({ id: u.id, name: u.name }))} />
    </div>
  );
}
