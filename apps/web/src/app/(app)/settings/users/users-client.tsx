'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, KeyRound, Mail, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import type { UserRole, UserDTO } from '@influenceos/contracts';
import { USER_ROLES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { UserEditSheet } from './user-edit-sheet';
import { errorMessage } from '@/lib/errors';

export function UsersClient({ initial, currentUserId }: { initial: UserDTO[]; currentUserId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
    initialData: initial,
  });

  const users = usersQuery.data ?? [];
  const [editingUserId, setEditingUserId] = React.useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = React.useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = React.useState<string | null>(null);
  const deletingUser = users.find((u) => u.id === deletingUserId) ?? null;
  const resettingUser = users.find((u) => u.id === resettingUserId) ?? null;

  const removeUser = useMutation({
    mutationFn: (id: string) => api.users.remove(id),
    onSuccess: () => {
      toast.success(t('list.deletedToast'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      router.refresh();
      setDeletingUserId(null);
    },
    onError: (e) => toast.error(errorMessage(e, t('list.errorGeneric'))),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t('list.teammateCount', { count: users.length })}</p>
        <AddUserDialog />
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title={t('list.empty.title')}
          description={t('list.empty.description')}
          action={<AddUserDialog />}
          className="py-16"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/60 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 text-start">{t('list.table.user')}</th>
                  <th className="px-5 py-3 text-start">{t('list.table.email')}</th>
                  <th className="px-5 py-3 text-start">{t('list.table.role')}</th>
                  <th className="px-5 py-3 text-start">{t('list.table.status')}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="cursor-pointer transition-colors hover:bg-surface-muted/50"
                    onClick={() => setEditingUserId(u.id)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                        <span className="font-medium">
                          <BidiText>{u.name}</BidiText>
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <LtrText>{u.email}</LtrText>
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={u.role === 'ADMIN' ? 'accent' : 'info'} className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          {t(`list.roleLabel.${u.role}`)}
                        </Badge>
                        {u.roleProfile && (
                          <Badge tone="neutral">{enumLabel(tEnums, 'roleProfile', u.roleProfile)}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone={u.isActive ? 'success' : 'neutral'}>
                        {u.isActive ? t('list.active') : t('list.inactive')}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingUserId(u.id);
                          }}
                        >
                          {t('list.editAccess')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={t('list.resetPassword')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setResettingUserId(u.id);
                          }}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={u.id === currentUserId ? t('list.cannotDeleteSelf') : t('list.deleteUser')}
                          disabled={u.id === currentUserId}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingUserId(u.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <UserEditSheet userId={editingUserId} onOpenChange={(open) => !open && setEditingUserId(null)} />

      <ResetPasswordDialog user={resettingUser} onOpenChange={(open) => !open && setResettingUserId(null)} />

      <ConfirmDialog
        open={!!deletingUserId}
        onOpenChange={(open) => !open && setDeletingUserId(null)}
        title={t('list.deleteConfirmTitle', { name: deletingUser?.name ?? '' })}
        description={t('list.deleteConfirmDescription')}
        confirmLabel={tCommon('delete')}
        loading={removeUser.isPending}
        onConfirm={() => deletingUserId && removeUser.mutate(deletingUserId)}
      />
    </div>
  );
}

type PasswordIssueKey = 'length' | 'case' | 'number';

function passwordStrengthIssues(pw: string): PasswordIssueKey[] {
  const issues: PasswordIssueKey[] = [];
  if (pw.length < 10) issues.push('length');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('case');
  if (!/[0-9]/.test(pw)) issues.push('number');
  return issues;
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserDTO | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const open = user != null;
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  function reset() {
    setNewPassword('');
    setConfirmPassword('');
  }

  const issues = passwordStrengthIssues(newPassword);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = issues.length === 0 && newPassword === confirmPassword;

  const resetPassword = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('No user selected');
      return api.users.resetPassword(user.id, { newPassword });
    },
    onSuccess: () => {
      toast.success(t('list.resetPasswordDialog.successToast', { name: user?.name ?? '' }));
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, t('list.resetPasswordDialog.errorToast'))),
  });

  const issuesHint =
    newPassword.length > 0 && issues.length > 0
      ? t('list.resetPasswordDialog.hintNeeds', {
          list: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
            issues.map((k) => t(`list.resetPasswordDialog.issue.${k}`)),
          ),
        })
      : t('list.resetPasswordDialog.hintDefault');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('list.resetPasswordDialog.title', { name: user?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('list.resetPasswordDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('list.resetPasswordDialog.newPassword')} hint={issuesHint}>
            <Input
              type="password"
              autoFocus
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field
            label={t('list.resetPasswordDialog.confirmNewPassword')}
            hint={mismatch ? t('list.resetPasswordDialog.mismatch') : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit || resetPassword.isPending} onClick={() => resetPassword.mutate()}>
            {resetPassword.isPending ? <Spinner className="text-current" /> : <KeyRound className="h-4 w-4" />}
            {resetPassword.isPending ? t('list.resetPasswordDialog.submitting') : t('list.resetPasswordDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState<UserRole>('STAFF');

  const createUser = useMutation({
    mutationFn: () =>
      api.users.create({
        email: email.trim(),
        name: name.trim(),
        password,
        role,
      }),
    onSuccess: (user) => {
      toast.success(t('list.toastAdded', { name: user.name }));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      router.refresh();
      resetAndClose();
    },
    onError: (e) => toast.error(errorMessage(e, t('list.errorGeneric'))),
  });

  function resetAndClose() {
    setOpen(false);
    setEmail('');
    setName('');
    setPassword('');
    setRole('STAFF');
  }

  const canSubmit = email.trim().length > 0 && name.trim().length > 0 && password.length >= 8;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> {t('list.addUser')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('list.addUserDialog.title')}</DialogTitle>
          <DialogDescription>{t('list.addUserDialog.description')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createUser.mutate();
          }}
        >
          <Field label={t('list.addUserDialog.fullName')}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('list.addUserDialog.fullNamePlaceholder')}
              maxLength={200}
              required
            />
          </Field>
          <Field label={t('list.addUserDialog.email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('list.addUserDialog.emailPlaceholder')}
              dir="ltr"
              required
            />
          </Field>
          <Field label={t('list.addUserDialog.password')} hint={t('list.addUserDialog.passwordHint')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </Field>
          <Field label={t('list.addUserDialog.role')}>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`list.roleLabel.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit || createUser.isPending} onClick={() => createUser.mutate()}>
            {createUser.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {createUser.isPending ? t('list.addUserDialog.submitting') : t('list.addUserDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
