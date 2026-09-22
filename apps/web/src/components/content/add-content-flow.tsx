'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, Link2, Upload } from 'lucide-react';
import type { CampaignInfluencerDTO, DeliverableDTO, PublishedContentDTO } from '@influenceos/contracts';
import { PLATFORMS, PLATFORM_META, type Platform } from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { uploadAttachment } from '@/lib/upload';
import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BidiText } from '@/components/common/bidi-text';
import { cn } from '@/lib/cn';

const NO_INFLUENCER = '__none__';
const NO_CAMPAIGN = '__none__';
const NO_DELIVERABLE = '__none__';

export interface AddContentFlowProps {
  /** Called after a successful create, with the created content. */
  onSuccess: (content: PublishedContentDTO) => void;
  onCancel?: () => void;
  /** Fixed context — when set, that field is not user-editable and is shown read-only. */
  lockInfluencerId?: string;
  lockInfluencerName?: string;
  lockCampaignId?: string;
  lockCampaignName?: string;
  lockDeliverableId?: string;
  lockDeliverableLabel?: string;
  /**
   * Campaign Workspace context: restrict the influencer selector to this
   * campaign's own roster (never a creator who isn't on it), and derive the
   * deliverable selector from the selected influencer's own deliverables on
   * this campaign. Prevents SCENARIO E's invalid combination by construction
   * instead of relying solely on the server rejecting it after the fact.
   */
  rosterScope?: CampaignInfluencerDTO[];
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * The ONE content-association create flow (per the "no duplicate forms"
 * policy). Reused, with different contextual defaults, by: Quick Add
 * (nothing preselected), the Influencer page (influencer locked), the
 * Campaign Live Content tab (campaign locked, roster-scoped selectors), and a
 * Deliverable row (deliverable locked — everything else is derived
 * server-side, no selectors shown at all). Business validation always stays
 * server-side (resolveContentAssociation) — this component only decides
 * which fields to show, never which combinations are valid.
 */
export function AddContentFlow({
  onSuccess,
  onCancel,
  lockInfluencerId,
  lockInfluencerName,
  lockCampaignId,
  lockCampaignName,
  lockDeliverableId,
  lockDeliverableLabel,
  rosterScope,
}: AddContentFlowProps) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [mode, setMode] = React.useState<'link' | 'story'>('link');
  const [url, setUrl] = React.useState('');
  const [influencerId, setInfluencerId] = React.useState(lockInfluencerId ?? '');
  const [campaignId, setCampaignId] = React.useState(lockCampaignId ?? '');
  const [deliverableId, setDeliverableId] = React.useState(lockDeliverableId ?? '');
  const [loading, setLoading] = React.useState(false);

  // Story mode — a screenshot/recording, not a link (see AddContentFlowProps
  // doc comment). storyContentId remembers the row created by createStory()
  // so a failed attachment upload can be retried without creating a
  // duplicate PublishedContent row.
  const [storyPlatform, setStoryPlatform] = React.useState<Platform | ''>('');
  const [storyFile, setStoryFile] = React.useState<File | null>(null);
  const [storyFileMissing, setStoryFileMissing] = React.useState(false);
  const [storyContentId, setStoryContentId] = React.useState<string | null>(null);
  const [storyUploadFailed, setStoryUploadFailed] = React.useState(false);
  const storyFileInputRef = React.useRef<HTMLInputElement>(null);

  const deliverableLocked = Boolean(lockDeliverableId);
  const campaignLocked = Boolean(lockCampaignId);
  const influencerLocked = Boolean(lockInfluencerId);

  const needsGlobalInfluencers = !deliverableLocked && !influencerLocked && !rosterScope;
  const needsGlobalCampaigns = !deliverableLocked && !campaignLocked;

  const influencerOptions = useQuery({
    queryKey: ['influencers', 'options'],
    queryFn: () => api.influencers.list({ pageSize: 100 }),
    enabled: needsGlobalInfluencers,
  });
  const campaignOptions = useQuery({
    queryKey: ['campaigns', 'options'],
    queryFn: () => api.campaigns.list({ pageSize: 100 }),
    enabled: needsGlobalCampaigns,
  });

  // Deliverables for the selected influencer within the roster scope — only
  // ever shown scoped to one campaign, matching "filtered by campaign/influencer".
  const deliverableOptions: DeliverableDTO[] = React.useMemo(() => {
    if (!rosterScope || !influencerId) return [];
    const ci = rosterScope.find((c) => c.influencer.id === influencerId);
    return ci?.deliverables ?? [];
  }, [rosterScope, influencerId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'story') return submitStory();
    if (!url.trim()) return;
    setLoading(true);
    try {
      const content = await api.content.create({
        url: url.trim(),
        influencerId: deliverableLocked ? undefined : influencerId || undefined,
        campaignId: deliverableLocked ? undefined : campaignId || undefined,
        deliverableId: deliverableLocked ? lockDeliverableId : deliverableId || undefined,
      });
      toast.success(t('addFlow.successToast'));
      onSuccess(content);
    } catch (e) {
      toast.error(errMessage(e, tCommon('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Two steps — create the row, then upload the media targeting it (same
   * two-phase signed upload every other attachment uses). If step one
   * succeeds but the upload fails, storyContentId is kept so re-submitting
   * retries only the upload instead of creating a second content row.
   */
  async function submitStory() {
    if (!storyPlatform) return;
    if (!storyFile) {
      setStoryFileMissing(true);
      return;
    }
    setLoading(true);
    try {
      let contentId = storyContentId;
      if (!contentId) {
        const created = await api.content.createStory({
          platform: storyPlatform,
          influencerId: deliverableLocked ? undefined : influencerId || undefined,
          campaignId: deliverableLocked ? undefined : campaignId || undefined,
          deliverableId: deliverableLocked ? lockDeliverableId : deliverableId || undefined,
        });
        contentId = created.id;
        setStoryContentId(contentId);
      }
      await uploadAttachment(storyFile, { publishedContentId: contentId });
      const finalContent = await api.content.get(contentId);
      toast.success(t('addFlow.successToast'));
      onSuccess(finalContent);
    } catch (err) {
      if (storyContentId) {
        setStoryUploadFailed(true);
        toast.error(t('addFlow.storyUploadFailed'));
      } else {
        toast.error(errMessage(err, tCommon('somethingWentWrong')));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-muted p-1">
        <button
          type="button"
          onClick={() => setMode('link')}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            mode === 'link' ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Link2 className="h-3.5 w-3.5" /> {t('addFlow.modeLink')}
        </button>
        <button
          type="button"
          onClick={() => setMode('story')}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            mode === 'story' ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Camera className="h-3.5 w-3.5" /> {t('addFlow.modeStory')}
        </button>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {mode === 'link' ? t('addFlow.modeLinkHint') : t('addFlow.modeStoryHint')}
      </p>

      {mode === 'link' ? (
        <Field label={t('addFlow.contentUrlLabel')} hint={t('addFlow.contentUrlHint')}>
          <Input
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            autoFocus
          />
        </Field>
      ) : (
        <>
          <Field label={t('addFlow.storyPlatformLabel')}>
            <Select value={storyPlatform || undefined} onValueChange={(v) => setStoryPlatform(v as Platform)}>
              <SelectTrigger>
                <SelectValue placeholder={t('addFlow.storyPlatformLabel')} />
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

          <Field
            label={t('addFlow.storyFileLabel')}
            hint={storyFile ? undefined : t('addFlow.storyFileHint')}
            error={storyFileMissing && !storyFile ? t('addFlow.storyFileRequired') : undefined}
          >
            <input
              ref={storyFileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setStoryFile(f);
                if (f) setStoryFileMissing(false);
              }}
            />
            <button
              type="button"
              onClick={() => storyFileInputRef.current?.click()}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border border-dashed border-border bg-surface-muted/40 px-3 py-2.5 text-sm transition-colors hover:border-brand/50 hover:bg-surface-muted',
                storyFileMissing && !storyFile && 'border-danger/60',
              )}
            >
              <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
              <BidiText as="span" className="truncate text-start">
                {storyFile ? storyFile.name : t('addFlow.storyFileChoose')}
              </BidiText>
            </button>
          </Field>

        </>
      )}

      {deliverableLocked ? (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          {t('addFlow.linkedToDeliverable', {
            label: lockDeliverableLabel ?? t('addFlow.thisDeliverable'),
          })}
        </div>
      ) : (
        <>
          {influencerLocked ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {t('addFlow.influencerLabel')}{' '}
              <BidiText as="span" className="font-medium text-foreground">
                {lockInfluencerName}
              </BidiText>
            </div>
          ) : (
            <Field label={t('addFlow.influencerFieldLabel')} hint={t('addFlow.influencerFieldHint')}>
              <Select
                value={influencerId || NO_INFLUENCER}
                onValueChange={(v) => setInfluencerId(v === NO_INFLUENCER ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.unknownInfluencer')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INFLUENCER}>{t('addFlow.unknownInfluencer')}</SelectItem>
                  {(rosterScope ?? []).map((ci) => (
                    <SelectItem key={ci.influencer.id} value={ci.influencer.id}>
                      <BidiText>{ci.influencer.displayName}</BidiText>
                    </SelectItem>
                  ))}
                  {(influencerOptions.data?.data ?? []).map((inf) => (
                    <SelectItem key={inf.id} value={inf.id}>
                      <BidiText>{inf.displayName}</BidiText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {campaignLocked ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {t('addFlow.campaignLabel')} <span className="font-medium text-foreground">{lockCampaignName}</span>
            </div>
          ) : (
            <Field label={t('addFlow.campaignFieldLabel')}>
              <Select value={campaignId || NO_CAMPAIGN} onValueChange={(v) => setCampaignId(v === NO_CAMPAIGN ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.linkToCampaign')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CAMPAIGN}>{t('associations.noCampaignIndependent')}</SelectItem>
                  {(campaignOptions.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.brand.name} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {rosterScope && influencerId ? (
            <Field label={t('addFlow.deliverableFieldLabel')} hint={t('addFlow.deliverableFieldHint')}>
              <Select
                value={deliverableId || NO_DELIVERABLE}
                onValueChange={(v) => setDeliverableId(v === NO_DELIVERABLE ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.noDeliverable')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DELIVERABLE}>{t('addFlow.noDeliverable')}</SelectItem>
                  {deliverableOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {enumLabel(tEnums, 'deliverableType', d.type)} · {d.platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </>
      )}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={loading}>
          {loading
            ? t('addFlow.adding')
            : mode === 'story'
              ? storyUploadFailed
                ? t('addFlow.retryUpload')
                : t('addFlow.addStory')
              : t('addFlow.addContent')}
        </Button>
      </div>
    </form>
  );
}
