'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function strengthIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 10) issues.push('at least 10 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('upper- and lower-case letters');
  if (!/[0-9]/.test(pw)) issues.push('a number');
  return issues;
}

export function ChangePasswordForm() {
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
      toast.success('Password changed. Please sign in again.');
      // Session policy: all sessions are revoked on password change, so send
      // the user to sign in again.
      setTimeout(() => router.push('/login'), 900);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not change your password.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Change password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field
          label="New password"
          hint={next.length > 0 && issues.length > 0 ? `Needs ${issues.join(', ')}.` : 'At least 10 chars, mixed case and a number.'}
        >
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="Confirm new password" hint={mismatch ? 'Passwords do not match.' : undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
        </Field>
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          For your security, changing your password signs you out of all sessions on every device. You'll sign in again with the new password.
        </p>
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Updating…' : 'Update password'}
        </Button>
      </CardFooter>
    </Card>
  );
}
