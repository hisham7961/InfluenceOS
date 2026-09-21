import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/common/page-header';
import { ChangePasswordForm } from './change-password-form';
import { SessionsList } from './sessions-list';

export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  const t = await getTranslations('settings');
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('security.title')} description={t('security.description')} />
      <div className="space-y-6">
        <ChangePasswordForm />
        <SessionsList />
      </div>
    </div>
  );
}
