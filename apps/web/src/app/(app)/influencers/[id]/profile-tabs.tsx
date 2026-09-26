'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Building2, Coins, Languages, Megaphone, PackageCheck, Pencil, Plus } from 'lucide-react';
import type {
  BrandInfluencerDTO,
  InfluencerDetailDTO,
  NoteDTO,
  CursorPage,
  PublishedContentDTO,
} from '@influenceos/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { AudienceHealthBadge, RelationshipStatusBadge } from '@/components/ui/status-badges';
import { StatCard } from '@/components/ui/stat-card';
import { PagedContentGrid } from '@/components/content/paged-content-grid';
import { AddContentFlow } from '@/components/content/add-content-flow';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { AttachmentsPanel } from '@/components/common/attachments-panel';
import { formatCurrency, useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { NotesPanel } from './notes-panel';
import { SocialAccountsPanel } from './social-accounts-panel';
import { CreatorTimeline } from './creator-timeline';
import { CreatorSubmissionsTab } from './creator-submissions-tab';
import { CreatorShipmentsTab } from './creator-shipments-tab';
import { BrandRelationshipDialog } from './brand-relationship-dialog';

/** "Add Content" preselecting this influencer — Critical Business Question 3. */
function AddContentButton({ influencerId, influencerName }: { influencerId: string; influencerName: string }) {
  const router = useRouter();
  const t = useTranslations('influencers');
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {t('detail.content.addContent')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detail.content.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('detail.content.dialogDescription', { name: influencerName })}</DialogDescription>
          </DialogHeader>
          <AddContentFlow
            lockInfluencerId={influencerId}
            lockInfluencerName={influencerName}
            onCancel={() => setOpen(false)}
            onSuccess={() => {
              qc.invalidateQueries();
              router.refresh();
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

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
  content: CursorPage<PublishedContentDTO>;
  notes: NoteDTO[];
  brandRelationships: BrandInfluencerDTO[];
}) {
  const t = useTranslations('influencers');
  const { shortDate, relativeTime } = useLocalizedFormat();
  const h = influencer.history;

  return (
    <Tabs defaultValue="overview">
      <TabsList className="flex-wrap">
        <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
        <TabsTrigger value="social">{t('detail.tabs.socialProfiles')}</TabsTrigger>
        <TabsTrigger value="history">{t('detail.tabs.campaignHistory')}</TabsTrigger>
        <TabsTrigger value="timeline">{t('detail.tabs.timeline')}</TabsTrigger>
        <TabsTrigger value="content">{t('detail.tabs.content')}</TabsTrigger>
        <TabsTrigger value="ugc">{t('detail.tabs.ugc')}</TabsTrigger>
        <TabsTrigger value="shipments">{t('detail.tabs.shipmentHistory')}</TabsTrigger>
        <TabsTrigger value="costs">{t('detail.tabs.costs')}</TabsTrigger>
        <TabsTrigger value="notes">{t('detail.tabs.notes')}</TabsTrigger>
        <TabsTrigger value="brands">{t('detail.tabs.brands')}</TabsTrigger>
        <TabsTrigger value="files">{t('detail.tabs.files')}</TabsTrigger>
      </TabsList>

      {/* Overview */}
      <TabsContent value="overview" className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.overview.aboutTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {influencer.bio ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{influencer.bio}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('detail.overview.noBio')}</p>
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
                <CardTitle>{t('detail.overview.notesTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {influencer.pricingNotes ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.overview.pricingNotesLabel')}</p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{influencer.pricingNotes}</p>
                  </div>
                ) : null}
                {influencer.internalNotes ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.overview.internalNotesLabel')}</p>
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
              <CardTitle>{t('detail.overview.audienceHealthTitle')}</CardTitle>
              <AudienceHealthBadge status={influencer.audience.label} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('detail.overview.dataPointsAnalyzed', { count: influencer.audience.dataPoints })}
            </p>
            {influencer.audience.signals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.overview.noSignalsYet')}</p>
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
      <TabsContent value="social">
        <SocialAccountsPanel influencerId={influencer.id} initialAccounts={influencer.socialAccounts} />
      </TabsContent>

      {/* Campaign History */}
      <TabsContent value="history" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label={t('detail.stats.campaigns')}
            value={h.campaignCount}
            icon={Megaphone}
            tone="info"
            hint={t('detail.stats.activeNow', { count: influencer.activeCampaigns })}
          />
          <StatCard
            label={t('detail.stats.deliverablesPublished')}
            value={h.deliverablesPublished}
            icon={PackageCheck}
            tone="success"
            hint={t('detail.stats.ofTotal', { count: h.deliverablesTotal })}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('detail.campaignHistory.timelineCardTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.campaignHistory.firstCollaboration')}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{shortDate(h.firstCollaborationAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.campaignHistory.lastCollaboration')}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{shortDate(h.lastCollaborationAt)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('detail.campaignHistory.brandsWorkedWithTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {h.brandsWorkedWith.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.campaignHistory.noBrandHistory')}</p>
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

      {/* Creator Master Timeline (Operations Intelligence pass, PART 29-30) —
          a unified, filterable chronology distinct from Chat/Notes: reuses
          ActivityLog, top-level Notes and DeliverableSubmission rows, never
          a duplicate history table. */}
      <TabsContent value="timeline">
        <CreatorTimeline influencerId={influencer.id} />
      </TabsContent>

      {/* UGC / Submissions (Final Completion Pass, gap #11) — every draft
          submitted across every campaign this creator has been on, reusing
          the same DeliverableSubmission rows/status badge as the campaign
          Submissions tab. Lazily fetched: only queries once this tab opens. */}
      <TabsContent value="ugc">
        <CreatorSubmissionsTab influencerId={influencer.id} />
      </TabsContent>

      {/* Shipment History (Final Completion Pass, gap #11) — every logistics
          request across every campaign this creator has been on, reusing the
          same cross-campaign shipments.list() the /logistics workspace reads
          (already scoped by brand/country, already filterable by influencerId).
          Lazily fetched: only queries once this tab opens. */}
      <TabsContent value="shipments">
        <CreatorShipmentsTab influencerId={influencer.id} />
      </TabsContent>

      {/* Content */}
      <TabsContent value="content" className="space-y-4">
        <div className="flex items-center justify-end">
          <AddContentButton influencerId={influencer.id} influencerName={influencer.displayName} />
        </div>
        <PagedContentGrid
          filter={{ influencerId: influencer.id }}
          initial={content}
          emptyTitle={t('detail.content.emptyTitle')}
          emptyDescription={t('detail.content.emptyDescription', { name: influencer.displayName })}
        />
      </TabsContent>

      {/* Costs */}
      <TabsContent value="costs" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label={t('detail.costs.totalPaid')} value={h.totalPaid} icon={Coins} tone="warning" format={(n) => formatCurrency(n)} />
          <StatCard label={t('detail.costs.averageRate')} value={h.averageRate} icon={Coins} tone="accent" format={(n) => formatCurrency(n)} />
          <StatCard
            label={t('detail.costs.deliverablesPublished')}
            value={h.deliverablesPublished}
            icon={PackageCheck}
            tone="success"
            hint={t('detail.stats.ofTotal', { count: h.deliverablesTotal })}
          />
        </div>
        {influencer.pricingNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.costs.pricingNotesTitle')}</CardTitle>
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
        <BrandRelationshipsPanel influencerId={influencer.id} relationships={brandRelationships} />
      </TabsContent>

      {/* Files: the creator's own paperwork (media kit, ID, bank letter). A
          campaign's agreement sits on that campaign's roster row. */}
      <TabsContent value="files">
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.files.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('detail.files.description')}</p>
          </CardHeader>
          <CardContent>
            <AttachmentsPanel target={{ influencerId: influencer.id }} compact />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

/** The creator's standing with each brand — status, usual rate, notes — editable. */
function BrandRelationshipsPanel({
  influencerId,
  relationships,
}: {
  influencerId: string;
  relationships: BrandInfluencerDTO[];
}) {
  const t = useTranslations('influencers');
  const { relativeTime } = useLocalizedFormat();
  const [editing, setEditing] = React.useState<BrandInfluencerDTO | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const open = (rel: BrandInfluencerDTO | null) => {
    setEditing(rel);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => open(null)}>
          <Plus className="h-4 w-4" /> {t('detail.brands.addButton')}
        </Button>
      </div>
      {relationships.length === 0 ? (
        <EmptyState icon={Building2} title={t('detail.brands.emptyTitle')} description={t('detail.brands.emptyDescription')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {relationships.map((rel) => (
            <Card key={rel.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={rel.brand.name} src={rel.brand.logoUrl ?? rel.brand.iconUrl} size="md" rounded="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    <BidiText>{rel.brand.name}</BidiText>
                  </p>
                  <RelationshipStatusBadge status={rel.relationshipStatus} className="mt-1" />
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('detail.brands.editAria', { brand: rel.brand.name })}
                  onClick={() => open(rel)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p className="uppercase tracking-wide">{t('detail.brands.collaborations')}</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{rel.totalCollaborations}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide">{t('detail.brands.defaultRate')}</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {rel.defaultRate != null ? <LtrText>{formatCurrency(rel.defaultRate, rel.currency ?? undefined)}</LtrText> : '—'}
                  </p>
                </div>
              </div>
              {rel.internalNotes ? (
                <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{rel.internalNotes}</p>
              ) : null}
              {rel.lastCampaignAt ? (
                <p className="text-xs text-muted-foreground">
                  {t('detail.brands.lastCampaign', { time: relativeTime(rel.lastCampaignAt) })}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <BrandRelationshipDialog
        influencerId={influencerId}
        relationship={editing}
        existingBrandIds={relationships.map((r) => r.brand.id)}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
