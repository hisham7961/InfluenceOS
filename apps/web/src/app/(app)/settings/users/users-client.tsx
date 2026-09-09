'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Mail, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import type { UserRole, UserDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { USER_ROLES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  STAFF: 'Staff',
};

export function UsersClient({ initial }: { initial: UserDTO[] }) {
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
    initialData: initial,
  });

  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? 'teammate' : 'teammates'} with access to this workspace.
        </p>
        <AddUserDialog />
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No users yet"
          description="Invite your first teammate to give them access to InfluenceOS."
          action={<AddUserDialog />}
          className="py-16"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/60 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="transition-colors hover:bg-surface-muted/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        {u.email}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone={u.role === 'ADMIN' ? 'accent' : 'info'} className="gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        {ROLE_LABEL[u.role]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function AddUserDialog() {
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
      toast.success(`${user.name} was added to the workspace.`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      router.refresh();
      resetAndClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
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
          <Plus className="h-4 w-4" /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>Create an account for a new teammate and set their role.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createUser.mutate();
          }}
        >
          <Field label="Full name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              maxLength={200}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@brand.com"
              required
            />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </Field>
          <Field label="Role">
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit || createUser.isPending} onClick={() => createUser.mutate()}>
            {createUser.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {createUser.isPending ? 'Adding…' : 'Add user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
