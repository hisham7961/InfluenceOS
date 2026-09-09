'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BadgeCheck,
  Check,
  ExternalLink,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trash2,
  Users,
} from 'lucide-react';
import type { SocialAccountDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { PLATFORMS, PLATFORM_META, type Platform } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { DataSourceBadge, ProvenanceTooltip } from '@/components/ui/provenance';
import { Field, Input, Label } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FollowerChart } from './follower-chart';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

function numeric(v: string): number | undefined {
  const t = v.trim();
  return t === '' ? undefined : Number(t);
}

/**
 * Add / edit dialog for a social account. In edit mode (`account` provided) it patches via
 * `api.socialAccounts.update`; otherwise it creates via `api.influencers.addSocialAccount`.
 */
function SocialAccountDialog({
  influencerId,
  account,
  trigger,
  onSaved,
}: {
  influencerId: string;
  account?: SocialAccountDTO;
  trigger: React.ReactNode;
  onSaved: () => void;
}) {
  const isEdit = Boolean(account);
  const [open, setOpen] = React.useState(false);
  const [platform, setPlatform] = React.useState<Platform>(account?.platform ?? 'INSTAGRAM');
  const [username, setUsername] = React.useState(account?.username ?? '');
  const [profileUrl, setProfileUrl] = React.useState(account?.profileUrl ?? '');
  const [displayName, setDisplayName] = React.useState(account?.displayName ?? '');
  const [followers, setFollowers] = React.useState(account?.followers != null ? String(account.followers) : '');
  const [following, setFollowing] = React.useState(account?.following != null ? String(account.following) : '');
  const [postCount, setPostCount] = React.useState(account?.postCount != null ? String(account.postCount) : '');
  const [isVerified, setIsVerified] = React.useState(Boolean(account?.isVerified));
  const [isPrimary, setIsPrimary] = React.useState(account?.isPrimary ?? false);

  // Re-seed from the source account whenever the dialog closes.
  React.useEffect(() => {
    if (open) return;
    setPlatform(account?.platform ?? 'INSTAGRAM');
    setUsername(account?.username ?? '');
    setProfileUrl(account?.profileUrl ?? '');
    setDisplayName(account?.displayName ?? '');
    setFollowers(account?.followers != null ? String(account.followers) : '');
    setFollowing(account?.following != null ? String(account.following) : '');
    setPostCount(account?.postCount != null ? String(account.postCount) : '');
    setIsVerified(Boolean(account?.isVerified));
    setIsPrimary(account?.isPrimary ?? false);
  }, [account, open]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        platform,
        username: username.trim(),
        profileUrl: profileUrl.trim() || null,
        displayName: displayName.trim() || null,
        followers: numeric(followers),
        following: numeric(following),
        postCount: numeric(postCount),
        isVerified,
        isPrimary,
      };
      return account
        ? api.socialAccounts.update(account.id, body)
        : api.influencers.addSocialAccount(influencerId, body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Social account updated.' : 'Social account added.');
      onSaved();
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit social account' : 'Add social account'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this platform profile.'
              : 'Link a platform profile to track its growth and content.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Platform">
            <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORM_META[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Username" hint="Without the @">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="creator" />
          </Field>

          <Field label="Display name" className="sm:col-span-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Shown on the card" />
          </Field>

          <Field label="Profile URL" hint="Optional" className="sm:col-span-2">
            <Input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://…" />
          </Field>

          <Field label="Followers">
            <Input type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Following">
            <Input type="number" min={0} value={following} onChange={(e) => setFollowing(e.target.value)} placeholder="0" />
          </Field>

          <Field label="Posts">
            <Input type="number" min={0} value={postCount} onChange={(e) => setPostCount(e.target.value)} placeholder="0" />
          </Field>

          <div className="flex flex-col justify-center gap-3 sm:pt-1">
            <div className="flex items-center justify-between gap-2">
              <Label>Verified</Label>
              <Switch aria-label="Verified" checked={isVerified} onCheckedChange={setIsVerified} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Primary account</Label>
              <Switch aria-label="Primary account" checked={isPrimary} onCheckedChange={setIsPrimary} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button disabled={!username.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SocialAccountCard({
  influencerId,
  account,
  onChanged,
}: {
  influencerId: string;
  account: SocialAccountDTO;
  onChanged: () => void;
}) {
  const sync = useMutation({
    mutationFn: () => api.socialAccounts.sync(account.id),
    onSuccess: (res) => {
      toast.success(res.message || (res.synced ? 'Account synced' : 'Sync ran, nothing new'));
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const remove = useMutation({
    mutationFn: () => api.socialAccounts.remove(account.id),
    onSuccess: () => {
      toast.success('Social account removed.');
      setConfirmOpen(false);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const delta = account.followerDelta7d;
  const DeltaIcon = !delta ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaTone = !delta ? 'text-muted-foreground' : delta > 0 ? 'text-success' : 'text-danger';

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={account.displayName ?? account.username} src={account.avatarUrl} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="truncate text-sm font-semibold">@{account.username}</p>
              {account.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-info" /> : null}
            </div>
            <PlatformBadge platform={account.platform} size="sm" />
          </div>
        </div>
        {account.isPrimary ? <Badge tone="accent">Primary</Badge> : null}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            {account.followers != null ? formatCompact(account.followers) : '—'}
          </p>
          <p className="text-xs text-muted-foreground">followers</p>
        </div>
        {delta != null ? (
          <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', deltaTone)}>
            <DeltaIcon className="h-3.5 w-3.5" />
            {delta > 0 ? '+' : ''}
            {formatCompact(delta)} · 7d
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <ProvenanceTooltip provenance={account.provenance}>
          <DataSourceBadge source={account.provenance.source} className="cursor-default" />
        </ProvenanceTooltip>
        <div className="flex items-center gap-1">
          {account.profileUrl ? (
            <Button asChild variant="ghost" size="icon-sm" title="Open profile">
              <a href={account.profileUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" title="Sync now" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} />
          </Button>
          <SocialAccountDialog
            influencerId={influencerId}
            account={account}
            onSaved={onChanged}
            trigger={
              <Button variant="ghost" size="icon-sm" title="Edit account">
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remove account"
            disabled={remove.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove social account?"
        description={`This removes @${account.username} on ${PLATFORM_META[account.platform].label}. This can't be undone.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}

/** Social Profiles tab: follower growth, per-account cards, and add / edit / remove management. */
export function SocialAccountsPanel({
  influencerId,
  initialAccounts,
}: {
  influencerId: string;
  initialAccounts: SocialAccountDTO[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ['influencer-social-accounts', influencerId],
    queryFn: () => api.influencers.socialAccounts(influencerId),
    initialData: initialAccounts,
  });
  const accounts = accountsQuery.data;

  function refresh() {
    void accountsQuery.refetch();
    queryClient.invalidateQueries();
    router.refresh();
  }

  const addButton = (
    <SocialAccountDialog
      influencerId={influencerId}
      onSaved={refresh}
      trigger={
        <Button size="sm">
          <Plus className="h-4 w-4" /> Add social account
        </Button>
      }
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Platforms this creator is active on.</p>
        {addButton}
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No social accounts linked"
          description="Add a social profile to start tracking growth and content."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Follower Growth</CardTitle>
            </CardHeader>
            <CardContent>
              <FollowerChart influencerId={influencerId} accounts={accounts} />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <SocialAccountCard
                key={account.id}
                influencerId={influencerId}
                account={account}
                onChanged={refresh}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
