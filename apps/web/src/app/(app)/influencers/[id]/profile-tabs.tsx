'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BadgeCheck,
  Building2,
  Coins,
  ExternalLink,
  Languages,
  Megaphone,
  Minus,
  PackageCheck,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import type {
  BrandInfluencerDTO,
  InfluencerDetailDTO,
  NoteDTO,
  PublishedContentDTO,
  SocialAccountDTO,
} from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { DataSourceBadge, ProvenanceTooltip } from '@/components/ui/provenance';
import { AudienceHealthBadge, RelationshipStatusBadge } from '@/components/ui/status-badges';
import { StatCard } from '@/components/ui/stat-card';
import { ContentGrid } from '@/components/content/content-grid';
import { formatCompact, formatCurrency, relativeTime, shortDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { NotesPanel } from './notes-panel';
import { FollowerChart } from './follower-chart';

const SEVERITY_DOT: Record<string, string> = {
  positive: 'bg-success',
  neutral: 'bg-muted-foreground',
  warning: 'bg-warning',
};

export function ProfileTabs({
  influencer,
  content,
  notes,
  brandRelationships,
}: {
  influencer: InfluencerDetailDTO;
  content: PublishedContentDTO[];
  notes: NoteDTO[];
  brandRelationships: BrandInfluencerDTO[];
}) {
  const h = influencer.history;

  return (
    <Tabs defaultValue="overview">
      <TabsList className="flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="social">Social Profiles</TabsTrigger>
        <TabsTrigger value="history">Campaign History</TabsTrigger>
        <TabsTrigger value="content">Content</TabsTrigger>
        <TabsTrigger value="costs">Costs</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="brands">Brands</TabsTrigger>
      </TabsList>

      {/* Overview */}
      <TabsContent value="overview" className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent>
              {influencer.bio ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{influencer.bio}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No bio on file yet.</p>
              )}
              {influencer.languages.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  {influencer.languages.map((l) => (
                    <Badge key={l} tone="neutral">
                      {l}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {influencer.pricingNotes || influencer.internalNotes ? (
            <Card>
              <CardHeader>
                <CardTitle>Pricing &amp; Internal Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {influencer.pricingNotes ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pricing notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{influencer.pricingNotes}</p>
                  </div>
                ) : null}
                {influencer.internalNotes ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Internal notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{influencer.internalNotes}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Audience Health</CardTitle>
              <AudienceHealthBadge status={influencer.audience.label} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {influencer.audience.dataPoints} data point{influencer.audience.dataPoints === 1 ? '' : 's'} analyzed
            </p>
            {influencer.audience.signals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audience signals yet.</p>
            ) : (
              <ul className="space-y-3">
                {influencer.audience.signals.map((s) => (
                  <li key={s.key} className="flex items-start gap-2.5 text-sm">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[s.severity])} />
                    <span className="text-foreground">{s.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Social Profiles */}
      <TabsContent value="social" className="space-y-6">
        {influencer.socialAccounts.length === 0 ? (
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
                <FollowerChart influencerId={influencer.id} accounts={influencer.socialAccounts} />
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {influencer.socialAccounts.map((account) => (
                <SocialAccountCard key={account.id} account={account} />
              ))}
            </div>
          </>
        )}
      </TabsContent>

      {/* Campaign History */}
      <TabsContent value="history" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Campaigns" value={h.campaignCount} icon={Megaphone} tone="info" hint={`${influencer.activeCampaigns} active now`} />
          <StatCard
            label="Deliverables Published"
            value={h.deliverablesPublished}
            icon={PackageCheck}
            tone="success"
            hint={`of ${h.deliverablesTotal} total`}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">First collaboration</p>
              <p className="mt-1 text-sm font-medium text-foreground">{shortDate(h.firstCollaborationAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last collaboration</p>
              <p className="mt-1 text-sm font-medium text-foreground">{shortDate(h.lastCollaborationAt)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Brands Worked With</CardTitle>
          </CardHeader>
          <CardContent>
            {h.brandsWorkedWith.length === 0 ? (
              <p className="text-sm text-muted-foreground">No brand history yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {h.brandsWorkedWith.map((b) => (
                  <Link
                    key={b.id}
                    href={`/brands/${b.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {b.name}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Content */}
      <TabsContent value="content">
        <ContentGrid
          items={content}
          emptyTitle="No content yet"
          emptyDescription={`Published content from ${influencer.displayName} will appear here.`}
        />
      </TabsContent>

      {/* Costs */}
      <TabsContent value="costs" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Total Paid" value={h.totalPaid} icon={Coins} tone="warning" format={(n) => formatCurrency(n)} />
          <StatCard label="Average Rate" value={h.averageRate} icon={Coins} tone="accent" format={(n) => formatCurrency(n)} />
          <StatCard
            label="Deliverables Published"
            value={h.deliverablesPublished}
            icon={PackageCheck}
            tone="success"
            hint={`of ${h.deliverablesTotal} total`}
          />
        </div>
        {influencer.pricingNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>Pricing Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-foreground">{influencer.pricingNotes}</p>
            </CardContent>
          </Card>
        ) : null}
      </TabsContent>

      {/* Notes */}
      <TabsContent value="notes">
        <NotesPanel influencerId={influencer.id} notes={notes} />
      </TabsContent>

      {/* Brands */}
      <TabsContent value="brands">
        {brandRelationships.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No brand relationships yet"
            description="Relationships with brands will appear here once this influencer joins a brand roster."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {brandRelationships.map((rel) => (
              <Card key={rel.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={rel.brand.name} src={rel.brand.logoUrl ?? rel.brand.iconUrl} size="md" rounded="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{rel.brand.name}</p>
                    <RelationshipStatusBadge status={rel.relationshipStatus} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <p className="uppercase tracking-wide">Collaborations</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">{rel.totalCollaborations}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide">Default rate</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {rel.defaultRate != null ? formatCurrency(rel.defaultRate, rel.currency ?? undefined) : '—'}
                    </p>
                  </div>
                </div>
                {rel.lastCampaignAt ? (
                  <p className="text-xs text-muted-foreground">Last campaign {relativeTime(rel.lastCampaignAt)}</p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function SocialAccountCard({ account }: { account: SocialAccountDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const sync = useMutation({
    mutationFn: () => api.socialAccounts.sync(account.id),
    onSuccess: (res) => {
      toast.success(res.message || (res.synced ? 'Account synced' : 'Sync ran, nothing new'));
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
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
        </div>
      </div>
    </Card>
  );
}
