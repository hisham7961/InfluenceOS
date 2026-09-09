import { PageHeader } from '@/components/common/page-header';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default function SecuritySettingsPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Security" description="Manage your password and account security." />
      <ChangePasswordForm />
    </div>
  );
}
