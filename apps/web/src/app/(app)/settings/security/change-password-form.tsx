'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';

type IssueKey = 'length' | 'case' | 'number';

function strengthIssues(pw: string): IssueKey[] {
  const issues: IssueKey[] = [];
  if (pw.length < 10) issues.push('length');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('case');
  if (!/[0-9]/.test(pw)) issues.push('number');
  return issues;
}

export function ChangePasswordForm() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const router = useRouter();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');

  const issues = strengthIssues(next);
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && issues.length === 0 && next === confirm;

  const mutation = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success(t('security.changePassword.successToast'));
      // Session policy: all sessions are revoked on password change, so send
      // the user to sign in again.
      setTimeout(() => router.push('/login'), 900);
    },
    onError: (e) => toast.error(errorMessage(e, t('security.changePassword.errorToast'))),
  });

  const issuesHint =
    next.length > 0 && issues.length > 0
      ? t('security.changePassword.hintNeeds', {
          list: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
            issues.map((k) => t(`security.changePassword.issue.${k}`)),
          ),
        })
      : t('security.changePassword.hintDefault');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> {t('security.changePassword.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t('security.changePassword.currentPassword')}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label={t('security.changePassword.newPassword')} hint={issuesHint}>
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field
          label={t('security.changePassword.confirmNewPassword')}
          hint={mismatch ? t('security.changePassword.mismatch') : undefined}
        >
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
        </Field>
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          {t('security.changePassword.securityNote')}
        </p>
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? t('security.changePassword.submitting') : t('security.changePassword.submit')}
        </Button>
      </CardFooter>
    </Card>
  );
}
