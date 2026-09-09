import { Database, HardDrive, Lock, ShieldAlert, Upload } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

export const dynamic = 'force-dynamic';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default async function StorageSettingsPage() {
  const api = getServerApi();

  let storage;
  try {
    storage = await api.platform.storage();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return (
        <div>
          <PageHeader title="Storage" description="Object storage configuration and file usage." />
          <EmptyState
            icon={ShieldAlert}
            title="Admins only"
            description="You need administrator access to view storage configuration."
            className="py-16"
          />
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Storage" description="Object storage configuration and file usage across the workspace." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={HardDrive} label="Driver" value={storage.driver === 's3' ? 'S3 / MinIO' : 'Local disk'} />
        <StatCard icon={Database} label="Files stored" value={storage.objectCount.toLocaleString()} />
        <StatCard icon={Database} label="Total size" value={formatBytes(storage.totalBytes)} />
        <StatCard icon={Upload} label="Max upload" value={`${storage.maxUploadMb} MB`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-success" /> Access model
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Private by default">
            <Badge tone="success" solid>
              {storage.privateByDefault ? 'Enabled' : 'Disabled'}
            </Badge>
          </Row>
          <p className="text-sm text-muted-foreground">
            Objects are never publicly readable. Every upload uses a signed, expiring URL and every download is served
            through a short-lived signed URL (presigned S3 GET, or a signed proxy link for the local driver). There is no
            public bucket and no permanent public file URL.
          </p>
          {storage.bucket ? <Row label="Bucket" value={storage.bucket} /> : null}
          {storage.endpoint ? <Row label="Endpoint" value={storage.endpoint} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed file types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {storage.allowedMimeTypes.map((mime) => (
              <Badge key={mime} tone="neutral">
                {mime}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Uploads are validated against this allowlist and the {storage.maxUploadMb} MB size limit on the server, and
            filenames are sanitized before storage.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2.5 last:border-0 last:pb-0">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children ?? <span className="truncate text-right font-mono text-sm">{value}</span>}
    </div>
  );
}
