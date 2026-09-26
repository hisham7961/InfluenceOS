import { Database, HardDrive, Lock, ShieldAlert, Upload } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LtrText } from '@/components/common/bidi-text';
import { formatBytes } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function StorageSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');

  let storage;
  try {
    storage = await api.platform.storage();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return (
        <div>
          <PageHeader title={t('storage.title')} description={t('storage.adminsOnly.description')} />
          <EmptyState
            icon={ShieldAlert}
            title={t('storage.adminsOnly.title')}
            description={t('storage.adminsOnly.detail')}
            className="py-16"
          />
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('storage.title')} description={t('storage.description')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={HardDrive}
          label={t('storage.driver')}
          value={storage.driver === 's3' ? t('storage.driverS3') : t('storage.driverLocal')}
        />
        <StatCard icon={Database} label={t('storage.filesStored')} value={storage.objectCount.toLocaleString()} />
        <StatCard icon={Database} label={t('storage.totalSize')} value={formatBytes(storage.totalBytes)} />
        <StatCard icon={Upload} label={t('storage.maxUpload')} value={`${storage.maxUploadMb} MB`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-success" /> {t('storage.accessModel.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label={t('storage.accessModel.privateByDefault')}>
            <Badge tone="success" solid>
              {storage.privateByDefault ? t('storage.accessModel.enabled') : t('storage.accessModel.disabled')}
            </Badge>
          </Row>
          <p className="text-sm text-muted-foreground">{t('storage.accessModel.explanation')}</p>
          {storage.bucket ? (
            <Row label={t('storage.accessModel.bucket')} value={<LtrText>{storage.bucket}</LtrText>} />
          ) : null}
          {storage.endpoint ? (
            <Row label={t('storage.accessModel.endpoint')} value={<LtrText>{storage.endpoint}</LtrText>} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('storage.allowedTypes.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {storage.allowedMimeTypes.map((mime) => (
              <Badge key={mime} tone="neutral">
                <LtrText>{mime}</LtrText>
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {t('storage.allowedTypes.explanation', { maxUploadMb: storage.maxUploadMb })}
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

function Row({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2.5 last:border-0 last:pb-0">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children ?? <span className="truncate text-end font-mono text-sm">{value}</span>}
    </div>
  );
}
