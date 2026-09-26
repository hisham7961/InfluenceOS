'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, Fingerprint, Search, Sparkles } from 'lucide-react';
import type { DuplicateCandidateDTO, DuplicateMatchConfidence, ResolveProfileResultDTO, Tone } from '@influenceos/contracts';
import {
  COUNTRIES,
  PLATFORMS,
  PLATFORM_META,
  PRIORITIES,
  RELATIONSHIP_STATUSES,
  type Platform,
  type Priority,
  type RelationshipStatus,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { DataSourceBadge } from '@/components/ui/provenance';
import { Spinner } from '@/components/ui/spinner';
import { LtrText } from '@/components/common/bidi-text';
import { errorMessage } from '@/lib/errors';

/** Sentinel for the platform Select's "let us detect it" option (Radix forbids an empty-string item value). */
const AUTO = 'auto';

const PRIORITY_TONE: Record<Priority, 'neutral' | 'info' | 'danger'> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'danger',
};

// Mirrors the confidence badge tone the Data Quality Center's
// duplicate-candidate rows already use (data-quality-workspace.tsx) — same
// visual language for the same DuplicateCandidateDTO.confidence values,
// so "exact" reads as more serious than a name-only "possible" match
// wherever a duplicate candidate is shown in the app. Both "strongPossible"
// and "possible" read the same localized label (form.duplicateWarning.confidencePossible)
// — only the tone differs — matching the source English copy this was extracted from.
const CONFIDENCE_TONE: Record<DuplicateMatchConfidence, Tone> = {
  exact: 'danger',
  strongPossible: 'warning',
  possible: 'neutral',
};

/** Minimum identifying info worth sending to /data-quality/duplicates/check
 *  — never fires the check on an empty or near-empty form. */
interface DuplicateCheckPayload {
  displayName?: string;
  platform?: Platform;
  username?: string;
  email?: string;
  mobile?: string;
  whatsapp?: string;
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}


/**
 * Non-blocking duplicate warning (PART 45-47 — Duplicate Detection wired
 * into the Add Influencer flow). Never auto-fills or merges anything from a
 * match into the form; only offers "Open existing profile" (navigate away)
 * or dismissing to "Proceed anyway" and keep creating a separate record.
 */
function DuplicateWarningCard({ matches, onDismiss }: { matches: DuplicateCandidateDTO[]; onDismiss: () => void }) {
  const t = useTranslations('influencers');
  const hasExact = matches.some((m) => m.confidence === 'exact');

  const reasonLabel = React.useCallback(
    (field: DuplicateCandidateDTO['reasons'][number]['field']): string => {
      switch (field) {
        case 'instagramUsername':
          return 'Instagram';
        case 'tiktokUsername':
          return 'TikTok';
        case 'youtubeUsername':
          return 'YouTube';
        case 'snapchatUsername':
          return 'Snapchat';
        case 'xUsername':
          return 'X';
        case 'email':
          return t('form.duplicateWarning.fieldEmail');
        case 'mobile':
          return t('form.duplicateWarning.fieldMobile');
        case 'whatsapp':
          return t('form.duplicateWarning.fieldWhatsapp');
        case 'name':
          return t('form.duplicateWarning.fieldName');
        default:
          return field;
      }
    },
    [t],
  );

  return (
    <Card className={cn('border', hasExact ? 'border-danger/30 bg-danger/5' : 'border-warning/30 bg-warning/5')}>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-start gap-2.5">
          <Fingerprint className={cn('mt-0.5 h-4 w-4 shrink-0', hasExact ? 'text-danger' : 'text-warning')} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {hasExact ? t('form.duplicateWarning.titleExact') : t('form.duplicateWarning.titlePossible')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('form.duplicateWarning.matchesFound', { count: matches.length })}{' '}
              {t('form.duplicateWarning.advisoryNote')}
            </p>
          </div>
        </div>

        <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-surface">
          {matches.map((m) => (
            <div key={m.influencerId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Avatar name={m.displayName} src={m.avatarUrl} size="sm" />
              {/* basis-40 gives this block a width floor so a narrow row wraps
                  the "Open existing profile" button onto its own line instead
                  of squeezing the name/reason text down to a few characters. */}
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{m.displayName}</p>
                  <Badge tone={CONFIDENCE_TONE[m.confidence]}>
                    {m.confidence === 'exact'
                      ? t('form.duplicateWarning.confidenceExact')
                      : t('form.duplicateWarning.confidencePossible')}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {m.reasons
                    .map((r) => t('form.duplicateWarning.sameField', { field: reasonLabel(r.field), value: r.value }))
                    .join(' · ')}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={`/influencers/${m.influencerId}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> {t('form.duplicateWarning.openExistingProfile')}
                </Link>
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            {t('form.duplicateWarning.proceedAnyway')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AddInfluencerForm() {
  const router = useRouter();
  const t = useTranslations('influencers');
  const tc = useTranslations('common');
  const te = useTranslations('enums');

  // Step 1 — resolve a pasted URL / handle into a profile preview.
  const [input, setInput] = React.useState('');
  const [platform, setPlatform] = React.useState<string>(AUTO);
  const [resolving, setResolving] = React.useState(false);
  const [resolveAttempted, setResolveAttempted] = React.useState(false);
  const [resolved, setResolved] = React.useState<ResolveProfileResultDTO | null>(null);

  // Step 2 — full details form.
  const [displayName, setDisplayName] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [countryCode, setCountryCode] = React.useState('');
  const [city, setCity] = React.useState('');
  // Default shipping address (W3-5) — a new shipment for this creator starts
  // from these, so capturing them here at creation makes shipment creation a
  // one-click prefill instead of re-typing the address every time.
  const [addressLine1, setAddressLine1] = React.useState('');
  const [addressLine2, setAddressLine2] = React.useState('');
  const [postalCode, setPostalCode] = React.useState('');
  const [deliveryInstructions, setDeliveryInstructions] = React.useState('');
  const [languages, setLanguages] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [mobile, setMobile] = React.useState('');
  const [whatsapp, setWhatsapp] = React.useState('');
  const [priority, setPriority] = React.useState<Priority>('MEDIUM');
  const [relationshipStatus, setRelationshipStatus] = React.useState<RelationshipStatus>('PROSPECT');
  const [tags, setTags] = React.useState('');
  const [internalNotes, setInternalNotes] = React.useState('');
  const [pricingNotes, setPricingNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // Live pre-creation duplicate check — debounced ~500ms off whatever
  // identifying fields are filled in so far, across Step 1's resolved
  // profile and Step 2's contact fields. Advisory only: it never auto-fills,
  // merges or blocks submission, it just lets the user notice before they
  // create a second record for someone already in the system.
  const displayNameTrimmed = displayName.trim();
  const emailTrimmed = email.trim();
  const mobileTrimmed = mobile.trim();
  const whatsappTrimmed = whatsapp.trim();
  const resolvedPlatform = resolved?.platform;
  const resolvedUsername = resolved?.username;

  const hasEnoughToCheck =
    displayNameTrimmed.length >= 2 ||
    Boolean(resolvedUsername && resolvedPlatform) ||
    emailTrimmed.length > 0 ||
    mobileTrimmed.length > 0 ||
    whatsappTrimmed.length > 0;

  const [debouncedCheck, setDebouncedCheck] = React.useState<DuplicateCheckPayload | null>(null);
  const [duplicatesDismissed, setDuplicatesDismissed] = React.useState(false);

  React.useEffect(() => {
    if (!hasEnoughToCheck) {
      setDebouncedCheck(null);
      return;
    }
    const t = setTimeout(() => {
      setDuplicatesDismissed(false);
      setDebouncedCheck({
        displayName: displayNameTrimmed || undefined,
        platform: resolvedUsername ? resolvedPlatform : undefined,
        username: resolvedUsername || undefined,
        email: emailTrimmed || undefined,
        mobile: mobileTrimmed || undefined,
        whatsapp: whatsappTrimmed || undefined,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [hasEnoughToCheck, displayNameTrimmed, resolvedPlatform, resolvedUsername, emailTrimmed, mobileTrimmed, whatsappTrimmed]);

  const duplicatesQuery = useQuery({
    queryKey: ['add-influencer-duplicate-check', debouncedCheck] as const,
    queryFn: () => api.dataQuality.checkDuplicate(debouncedCheck!),
    enabled: debouncedCheck !== null,
    staleTime: 30_000,
  });

  const duplicateMatches = debouncedCheck ? (duplicatesQuery.data ?? []) : [];
  const showDuplicateWarning = duplicateMatches.length > 0 && !duplicatesDismissed;

  async function handleResolve() {
    const trimmed = input.trim();
    if (!trimmed) {
      toast.error(t('form.findCreator.pasteFirstToast'));
      return;
    }
    setResolving(true);
    setResolveAttempted(true);
    try {
      const r = await api.influencers.resolve({
        input: trimmed,
        platform: platform === AUTO ? undefined : (platform as Platform),
      });
      setResolved(r);
      setDisplayName((prev) => prev || r.displayName || r.username);
      if (r.manual) {
        toast.message(r.message ?? t('form.findCreator.manualDataUnavailableToast'));
      } else {
        toast.success(t('form.findCreator.foundToast', { username: r.username, platform: PLATFORM_META[r.platform].label }));
      }
    } catch (e) {
      setResolved(null);
      toast.error(errorMessage(e, t('errors.generic')));
    } finally {
      setResolving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) {
      toast.error(t('form.validation.displayNameRequired'));
      return;
    }
    if (!countryCode) {
      toast.error(t('form.validation.countryRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const influencer = await api.influencers.create({
        displayName: name,
        fullName: fullName.trim() || undefined,
        category: category.trim() || undefined,
        country: country.trim() || undefined,
        countryCode,
        city: city.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        deliveryInstructions: deliveryInstructions.trim() || undefined,
        languages: splitList(languages),
        email: email.trim() || undefined,
        mobile: mobile.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        priority,
        relationshipStatus,
        tags: splitList(tags),
        internalNotes: internalNotes.trim() || undefined,
        pricingNotes: pricingNotes.trim() || undefined,
      });

      if (resolved) {
        try {
          await api.influencers.addSocialAccount(influencer.id, {
            platform: resolved.platform,
            username: resolved.username,
            profileUrl: resolved.profileUrl || undefined,
            displayName: resolved.displayName || undefined,
            avatarUrl: resolved.avatarUrl || undefined,
            bio: resolved.bio || undefined,
            followers: resolved.followers,
            following: resolved.following,
            postCount: resolved.postCount,
            isVerified: resolved.isVerified,
            isPrimary: true,
          });
        } catch (linkError) {
          toast.error(
            t('form.linkFailedToast', { error: errorMessage(linkError, t('errors.generic')) }),
          );
          router.push(`/influencers/${influencer.id}`);
          return;
        }
      }

      toast.success(t('form.successToast', { name: influencer.displayName }));
      router.push(`/influencers/${influencer.id}`);
    } catch (e) {
      toast.error(errorMessage(e, t('errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader className="gap-1.5 border-b border-border pb-5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                1
              </span>
              <CardTitle>{t('form.findCreator.cardTitle')}</CardTitle>
            </div>
            <CardDescription>{t('form.findCreator.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t('form.findCreator.inputPlaceholder')}
                  className="ps-9"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleResolve();
                    }
                  }}
                />
              </div>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="sm:w-40">
                  <SelectValue placeholder={t('form.findCreator.platformPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>{t('form.findCreator.autoDetect')}</SelectItem>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                onClick={handleResolve}
                disabled={resolving}
                className="sm:w-36"
              >
                {resolving ? <Spinner className="text-current" /> : <Sparkles className="h-4 w-4" />}
                {resolving ? t('form.findCreator.resolving') : t('form.findCreator.resolve')}
              </Button>
            </div>

            {resolved ? (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4',
                  resolved.manual ? 'border-warning/30 bg-warning/5' : 'border-success/30 bg-success/5',
                )}
              >
                <Avatar
                  name={resolved.displayName ?? resolved.username}
                  src={resolved.avatarUrl}
                  size="lg"
                  rounded="lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold">{resolved.displayName ?? resolved.username}</p>
                    <DataSourceBadge source={resolved.source} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <PlatformIcon
                        platform={resolved.platform}
                        className="h-3.5 w-3.5"
                        style={{ color: PLATFORM_META[resolved.platform].color }}
                      />
                      <LtrText>@{resolved.username}</LtrText>
                    </span>
                    {resolved.followers != null ? (
                      <span>
                        {t.rich('form.findCreator.followersSuffix', {
                          count: formatCompact(resolved.followers),
                          ltr: (chunks) => <LtrText>{chunks}</LtrText>,
                        })}
                      </span>
                    ) : null}
                    {resolved.isVerified ? (
                      <span className="inline-flex items-center gap-1 text-brand">
                        <Check className="h-3.5 w-3.5" /> {t('form.findCreator.verified')}
                      </span>
                    ) : null}
                  </div>
                  {resolved.manual && resolved.message ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {resolved.message}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : resolveAttempted && !resolving ? (
              <div className="rounded-xl border border-dashed border-border bg-surface-muted/60 px-4 py-3 text-sm text-muted-foreground">
                {t('form.findCreator.couldNotResolve')}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('form.findCreator.skipHint')}</p>
            )}
          </CardContent>
        </Card>

        {showDuplicateWarning ? (
          <DuplicateWarningCard matches={duplicateMatches} onDismiss={() => setDuplicatesDismissed(true)} />
        ) : null}

        <Card>
          <CardHeader className="gap-1.5 border-b border-border pb-5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                2
              </span>
              <CardTitle>{t('form.details.cardTitle')}</CardTitle>
            </div>
            <CardDescription>{t('form.details.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 pt-5 sm:grid-cols-2">
            <Field label={t('form.fields.displayName')} hint={t('form.fields.displayNameHint')}>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('form.fields.displayNamePlaceholder')}
                required
              />
            </Field>
            <Field label={t('form.fields.fullName')}>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('form.fields.fullNamePlaceholder')} />
            </Field>

            <Field label={t('form.fields.category')}>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('form.fields.categoryPlaceholder')} />
            </Field>
            <Field label={t('form.fields.priority')}>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {enumLabel(te, 'priority', p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={t('form.fields.country')} hint={t('form.fields.countryRequiredHint')}>
              <Select
                value={countryCode}
                onValueChange={(v) => {
                  setCountryCode(v);
                  setCountry(COUNTRIES.find((c) => c.code === v)?.name ?? country);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('form.fields.countryPlaceholder')} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('form.fields.city')}>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('form.fields.cityPlaceholder')} />
            </Field>

            <Field label={t('form.fields.addressLine1')} className="sm:col-span-2">
              <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder={t('form.fields.addressLine1Placeholder')} />
            </Field>
            <Field label={t('form.fields.addressLine2')} className="sm:col-span-2">
              <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder={t('form.fields.addressLine2Placeholder')} />
            </Field>
            <Field label={t('form.fields.postalCode')}>
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder={t('form.fields.postalCodePlaceholder')} />
            </Field>
            <Field label={t('form.fields.deliveryInstructions')} className="sm:col-span-2">
              <Textarea
                rows={2}
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                placeholder={t('form.fields.deliveryInstructionsPlaceholder')}
              />
            </Field>

            <Field label={t('form.fields.relationshipStatus')}>
              <Select value={relationshipStatus} onValueChange={(v) => setRelationshipStatus(v as RelationshipStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {enumLabel(te, 'relationshipStatus', s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('form.fields.languages')} hint={t('form.fields.languagesHint')}>
              <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder={t('form.fields.languagesPlaceholder')} />
            </Field>

            <Field label={t('form.fields.email')}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('form.fields.emailPlaceholder')}
              />
            </Field>
            <Field label={t('form.fields.mobile')}>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder={t('form.fields.mobilePlaceholder')} />
            </Field>

            <Field label={t('form.fields.whatsapp')}>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={t('form.fields.whatsappPlaceholder')} />
            </Field>
            <Field label={t('form.fields.tags')} hint={t('form.fields.tagsHint')}>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('form.fields.tagsPlaceholder')} />
            </Field>

            <Field label={t('form.fields.pricingNotes')} className="sm:col-span-2">
              <Textarea
                value={pricingNotes}
                onChange={(e) => setPricingNotes(e.target.value)}
                placeholder={t('form.fields.pricingNotesPlaceholder')}
              />
            </Field>
            <Field label={t('form.fields.internalNotes')} className="sm:col-span-2">
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder={t('form.fields.internalNotesPlaceholder')}
              />
            </Field>
          </CardContent>
          <CardFooter className="justify-end gap-3 border-t border-border pt-5">
            <Button type="button" variant="outline" onClick={() => router.push('/influencers')} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Spinner className="text-current" /> : null}
              {submitting ? t('form.submit.adding') : t('directory.addInfluencer')}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <aside className="lg:sticky lg:top-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('form.preview.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pt-0 text-center">
            <Avatar name={displayName || t('form.preview.fallbackName')} src={resolved?.avatarUrl} size="2xl" rounded="lg" />
            <div>
              <p className="text-lg font-semibold">{displayName || t('form.preview.fallbackName')}</p>
              {resolved ? (
                <p className="text-sm text-muted-foreground">
                  <LtrText>@{resolved.username}</LtrText>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {resolved ? (
                <Badge tone="neutral">
                  <PlatformIcon platform={resolved.platform} className="h-3 w-3" />
                  {PLATFORM_META[resolved.platform].label}
                </Badge>
              ) : null}
              <Badge tone={PRIORITY_TONE[priority]}>{t('form.preview.priorityBadge', { priority: enumLabel(te, 'priority', priority) })}</Badge>
              <Badge tone="accent">{enumLabel(te, 'relationshipStatus', relationshipStatus)}</Badge>
            </div>
            {resolved?.followers != null ? (
              <div className="w-full rounded-xl bg-surface-muted px-3 py-2 text-sm">
                {t.rich('form.preview.followersCount', {
                  count: formatCompact(resolved.followers),
                  ltr: (chunks) => <LtrText>{chunks}</LtrText>,
                })}
              </div>
            ) : null}
            {!resolved && !displayName ? (
              <p className="text-xs text-muted-foreground">{t('form.preview.fillFormHint')}</p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
