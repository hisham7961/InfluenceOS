import { PageHeader } from '@/components/common/page-header';
import { ChangePasswordForm } from './change-password-form';
import { SessionsList } from './sessions-list';

export const dynamic = 'force-dynamic';

export default function SecuritySettingsPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Security" description="Manage your password and account security." />
      <div className="space-y-6">
        <ChangePasswordForm />
        <SessionsList />
      </div>
    </div>
  );
}
