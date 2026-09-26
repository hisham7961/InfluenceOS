'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Camera, Check, Link2, Upload, UserCheck } from 'lucide-react';
import type {
  CampaignInfluencerDTO,
  ContentUrlLookupDeliverableDTO,
  ContentUrlLookupDTO,
  DeliverableDTO,
  PublishedContentDTO,
} from '@influenceos/contracts';
import { PLATFORMS, PLATFORM_META, type Platform } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { uploadAttachment } from '@/lib/upload';
import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BidiText } from '@/components/common/bidi-text';
import { EntityCombobox } from '@/components/common/entity-combobox';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';

const NO_INFLUENCER = '__none__';
const NO_DELIVERABLE = '__none__';

/** Worth asking the server about: something with a dot and no spaces. */
function looksLikeLink(value: string): boolean {
  const v = value.trim();
  return v.length > 8 && /\.[a-z]{2,}/i.test(v) && !/\s/.test(v);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

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
  /** A link to start with (e.g. the post link a creator sent from their task link). */
  initialUrl?: string;
}

function errMessage(e: unknown, fallback: string): string {
  return errorMessage(e, fallback);
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
  initialUrl,
}: AddContentFlowProps) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [mode, setMode] = React.useState<'link' | 'story'>('link');
  const [url, setUrl] = React.useState(initialUrl ?? '');
  const [influencerId, setInfluencerId] = React.useState(lockInfluencerId ?? '');
  const [influencerLabel, setInfluencerLabel] = React.useState<string | null>(null);
  const [campaignId, setCampaignId] = React.useState(lockCampaignId ?? '');
  const [campaignLabel, setCampaignLabel] = React.useState<string | null>(null);
  const [deliverableId, setDeliverableId] = React.useState(lockDeliverableId ?? '');
  const [loading, setLoading] = React.useState(false);
  // Once someone picks by hand, a pasted link never overrides their choice.
  const touched = React.useRef({ influencer: false, link: false });

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

  // What the pasted link is: who posted it, their open deliverables, and
  // whether it's already on the wall — so the form can fill itself in.
  const debouncedUrl = useDebounced(url.trim(), 450);
  const lookup = useQuery({
    queryKey: ['content-lookup', debouncedUrl, lockCampaignId ?? ''],
    queryFn: () => api.content.lookup({ url: debouncedUrl, campaignId: lockCampaignId }),
    enabled: mode === 'link' && looksLikeLink(debouncedUrl),
    staleTime: 60_000,
    retry: false,
  });
  const found: ContentUrlLookupDTO | undefined =
    mode === 'link' && lookup.data && debouncedUrl === url.trim() ? lookup.data : undefined;
  const rosterIds = React.useMemo(() => new Set((rosterScope ?? []).map((c) => c.influencer.id)), [rosterScope]);
  const suggestions = React.useMemo(
    () =>
      deliverableLocked
        ? []
        : (found?.openDeliverables ?? []).filter(
            (d) =>
              (!lockCampaignId || d.campaignId === lockCampaignId) &&
              (!lockInfluencerId || found?.influencer?.id === lockInfluencerId),
          ),
    [found, deliverableLocked, lockCampaignId, lockInfluencerId],
  );

  function pickSuggestion(d: ContentUrlLookupDeliverableDTO | null) {
    if (!d) {
      setDeliverableId('');
      return;
    }
    setDeliverableId(d.deliverableId);
    if (!campaignLocked) {
      setCampaignId(d.campaignId);
      setCampaignLabel(`${d.campaignName} · ${d.brandName}`);
    }
    if (!influencerLocked && found?.influencer) {
      setInfluencerId(found.influencer.id);
      setInfluencerLabel(found.influencer.displayName);
    }
  }

  // Apply a new link's match once — the creator, and their deliverable on
  // this platform that's due soonest — unless the person already chose.
  const appliedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!found || appliedFor.current === debouncedUrl || deliverableLocked) return;
    appliedFor.current = debouncedUrl;
    const creator = found.influencer;
    const creatorAllowed = creator && (!rosterScope || rosterIds.has(creator.id));
    if (creator && creatorAllowed && !influencerLocked && !touched.current.influencer && !influencerId) {
      setInfluencerId(creator.id);
      setInfluencerLabel(creator.displayName);
    }
    const samePlatform = suggestions.find((d) => d.platform === found.platform);
    if (
      samePlatform &&
      !touched.current.link &&
      !deliverableId &&
      (!campaignId || campaignId === samePlatform.campaignId)
    ) {
      pickSuggestion(samePlatform);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, debouncedUrl]);

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

      {found ? (
        <LinkFindings
          found={found}
          suggestions={suggestions}
          selectedDeliverableId={deliverableId}
          onPick={(d) => {
            touched.current.link = true;
            pickSuggestion(d);
          }}
        />
      ) : null}

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
          ) : rosterScope ? (
            <Field label={t('addFlow.influencerFieldLabel')} hint={t('addFlow.influencerFieldHint')}>
              <Select
                value={influencerId || NO_INFLUENCER}
                onValueChange={(v) => {
                  touched.current.influencer = true;
                  setInfluencerId(v === NO_INFLUENCER ? '' : v);
                  setDeliverableId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.unknownInfluencer')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INFLUENCER}>{t('addFlow.unknownInfluencer')}</SelectItem>
                  {rosterScope.map((ci) => (
                    <SelectItem key={ci.influencer.id} value={ci.influencer.id}>
                      <BidiText>{ci.influencer.displayName}</BidiText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label={t('addFlow.influencerFieldLabel')} hint={t('addFlow.influencerFieldHint')}>
              <EntityCombobox
                kind="influencer"
                value={influencerId}
                valueLabel={influencerLabel}
                onChange={(id, option) => {
                  touched.current.influencer = true;
                  setInfluencerId(id);
                  setInfluencerLabel(option?.label ?? null);
                  if (deliverableId && id !== found?.influencer?.id) setDeliverableId('');
                }}
                placeholder={t('addFlow.unknownInfluencer')}
                noneLabel={t('addFlow.unknownInfluencer')}
                aria-label={t('addFlow.influencerFieldLabel')}
              />
            </Field>
          )}

          {campaignLocked ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {t('addFlow.campaignLabel')} <span className="font-medium text-foreground">{lockCampaignName}</span>
            </div>
          ) : (
            <Field label={t('addFlow.campaignFieldLabel')}>
              <EntityCombobox
                kind="campaign"
                value={campaignId}
                valueLabel={campaignLabel}
                onChange={(id, option) => {
                  touched.current.link = true;
                  setCampaignId(id);
                  setCampaignLabel(option ? [option.label, option.detail].filter(Boolean).join(' · ') : null);
                  if (deliverableId && !suggestions.some((d) => d.deliverableId === deliverableId && d.campaignId === id)) {
                    setDeliverableId('');
                  }
                }}
                placeholder={t('addFlow.linkToCampaign')}
                noneLabel={t('associations.noCampaignIndependent')}
                aria-label={t('addFlow.campaignFieldLabel')}
              />
            </Field>
          )}

          {rosterScope && influencerId ? (
            <Field label={t('addFlow.deliverableFieldLabel')} hint={t('addFlow.deliverableFieldHint')}>
              <Select
                value={deliverableId || NO_DELIVERABLE}
                onValueChange={(v) => {
                  touched.current.link = true;
                  setDeliverableId(v === NO_DELIVERABLE ? '' : v);
                }}
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

/**
 * What the pasted link turned out to be: already on the wall, a share link
 * that couldn't be opened, who posted it, and which of their deliverables it
 * can fulfil (click to choose; click again to leave it unlinked).
 */
function LinkFindings({
  found,
  suggestions,
  selectedDeliverableId,
  onPick,
}: {
  found: ContentUrlLookupDTO;
  suggestions: ContentUrlLookupDeliverableDTO[];
  selectedDeliverableId: string;
  onPick: (d: ContentUrlLookupDeliverableDTO | null) => void;
}) {
  const t = useTranslations('content');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  return (
    <div className="-mt-2 space-y-2">
      {found.existing ? (
        <div className="border-warning/40 bg-warning/10 text-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('addFlow.alreadyAdded')}{' '}
            {found.existing.id ? (
              <Link
                href={`/content/${found.existing.id}`}
                className="text-brand font-medium hover:underline"
              >
                {t('addFlow.openExisting')}
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
      {found.unresolvedShortLink ? (
        <p className="border-border bg-surface-muted text-muted-foreground rounded-lg border px-3 py-2 text-xs">
          {t('addFlow.shortLinkUnresolved')}
        </p>
      ) : null}
      {!found.canonicalUrl && !found.unresolvedShortLink ? (
        <p className="text-danger text-xs">{t('addFlow.unsupportedLink')}</p>
      ) : null}
      {found.influencer ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <UserCheck className="text-success h-3.5 w-3.5" />
          {t.rich('addFlow.postedBy', {
            handle: () => <bdi dir="ltr">@{found.handle}</bdi>,
            name: () => (
              <BidiText className="text-foreground font-medium">
                {found.influencer!.displayName}
              </BidiText>
            ),
          })}
        </p>
      ) : found.handle ? (
        <p className="text-muted-foreground text-xs">
          {t.rich('addFlow.handleUnknown', { handle: () => <bdi dir="ltr">@{found.handle}</bdi> })}
        </p>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            {t('addFlow.fulfilsDeliverable')}
          </p>
          {suggestions.map((d) => {
            const selected = d.deliverableId === selectedDeliverableId;
            return (
              <button
                key={d.deliverableId}
                type="button"
                aria-pressed={selected}
                onClick={() => onPick(selected ? null : d)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm transition-colors',
                  selected
                    ? 'border-brand bg-brand-soft/50'
                    : 'border-border hover:bg-surface-muted',
                )}
              >
                <PlatformIcon platform={d.platform} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {d.campaignName}{' '}
                    <span className="text-muted-foreground font-normal">· {d.brandName}</span>
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {enumLabel(tEnums, 'deliverableType', d.type)}
                    {d.dueDate ? ` · ${t('addFlow.due', { date: shortDate(d.dueDate) })}` : ''}
                    {d.status === 'MISSED'
                      ? ` · ${enumLabel(tEnums, 'deliverableStatus', d.status)}`
                      : ''}
                  </span>
                </span>
                <Check
                  className={cn(
                    'text-brand h-4 w-4 shrink-0',
                    selected ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
