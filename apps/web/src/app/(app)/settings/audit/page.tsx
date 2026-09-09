import { ShieldAlert } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { AuditLogClient } from './audit-client';

export const dynamic = 'force-dynamic';

export default async function AuditLogPage() {
  const api = getServerApi();

  // Admin-gate on the current user; the audit feed itself is workspace-wide.
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

  let initial;
  try {
    initial = await api.activity.feed({ limit: 40 });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw e;
  }

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="A chronological, workspace-wide record of who did what and when."
      />
      <AuditLogClient initial={initial} />
    </div>
  );
}
