'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Search, Sparkles } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import type { ResolveProfileResultDTO } from '@influenceos/contracts';
import {
  PLATFORMS,
  PLATFORM_META,
  PRIORITIES,
  PRIORITY_LABELS,
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_STATUS_LABELS,
  type Platform,
  type Priority,
  type RelationshipStatus,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
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

/** Sentinel for the platform Select's "let us detect it" option (Radix forbids an empty-string item value). */
const AUTO = 'auto';

const PRIORITY_TONE: Record<Priority, 'neutral' | 'info' | 'danger'> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'danger',
};

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

export function AddInfluencerForm() {
  const router = useRouter();

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
  const [city, setCity] = React.useState('');
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

  async function handleResolve() {
    const trimmed = input.trim();
    if (!trimmed) {
      toast.error('Paste a profile URL or @handle first.');
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
        toast.message(r.message ?? 'Official data is unavailable for this profile — add it manually below.');
      } else {
        toast.success(`Found @${r.username} on ${PLATFORM_META[r.platform].label}.`);
      }
    } catch (e) {
      setResolved(null);
      toast.error(errorMessage(e));
    } finally {
      setResolving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) {
      toast.error('Display name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const influencer = await api.influencers.create({
        displayName: name,
        fullName: fullName.trim() || undefined,
        category: category.trim() || undefined,
        country: country.trim() || undefined,
        city: city.trim() || undefined,
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
          toast.error(`Influencer created, but linking the social account failed: ${errorMessage(linkError)}`);
          router.push(`/influencers/${influencer.id}`);
          return;
        }
      }

      toast.success(`${influencer.displayName} was added to your network.`);
      router.push(`/influencers/${influencer.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
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
              <CardTitle>Find the creator</CardTitle>
            </div>
            <CardDescription>
              Paste a profile URL or @handle — we&apos;ll try to pull their platform, avatar and follower count
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://instagram.com/creator or @creator"
                  className="pl-9"
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
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Auto-detect</SelectItem>
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
                {resolving ? 'Resolving…' : 'Resolve'}
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
                      @{resolved.username}
                    </span>
                    {resolved.followers != null ? <span>{formatCompact(resolved.followers)} followers</span> : null}
                    {resolved.isVerified ? (
                      <span className="inline-flex items-center gap-1 text-brand">
                        <Check className="h-3.5 w-3.5" /> Verified
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
                Couldn&apos;t resolve that profile. You can still fill in the details manually below.
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Optional — you can skip this and add every detail by hand instead.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5 border-b border-border pb-5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                2
              </span>
              <CardTitle>Creator details</CardTitle>
            </div>
            <CardDescription>Everything your team needs to reach out and track this relationship.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 pt-5 sm:grid-cols-2">
            <Field label="Display name" hint="Shown across InfluenceOS">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Sara Al-Fahad"
                required
              />
            </Field>
            <Field label="Full name">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Legal name" />
            </Field>

            <Field label="Category">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Beauty, Fitness, Food…" />
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Country">
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Kuwait" />
            </Field>
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Kuwait City" />
            </Field>

            <Field label="Relationship status">
              <Select value={relationshipStatus} onValueChange={(v) => setRelationshipStatus(v as RelationshipStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {RELATIONSHIP_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Languages" hint="Comma-separated">
              <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Arabic, English" />
            </Field>

            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="creator@email.com"
              />
            </Field>
            <Field label="Mobile">
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+965 ..." />
            </Field>

            <Field label="WhatsApp">
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+965 ..." />
            </Field>
            <Field label="Tags" hint="Comma-separated">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ramadan, macro, ugc" />
            </Field>

            <Field label="Pricing notes" className="sm:col-span-2">
              <Textarea
                value={pricingNotes}
                onChange={(e) => setPricingNotes(e.target.value)}
                placeholder="Standard rates, negotiables, past deals…"
              />
            </Field>
            <Field label="Internal notes" className="sm:col-span-2">
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Anything your team should know before reaching out"
              />
            </Field>
          </CardContent>
          <CardFooter className="justify-end gap-3 border-t border-border pt-5">
            <Button type="button" variant="outline" onClick={() => router.push('/influencers')} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Spinner className="text-current" /> : null}
              {submitting ? 'Adding…' : 'Add influencer'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <aside className="lg:sticky lg:top-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pt-0 text-center">
            <Avatar name={displayName || 'New creator'} src={resolved?.avatarUrl} size="2xl" rounded="lg" />
            <div>
              <p className="text-lg font-semibold">{displayName || 'New creator'}</p>
              {resolved ? <p className="text-sm text-muted-foreground">@{resolved.username}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {resolved ? (
                <Badge tone="neutral">
                  <PlatformIcon platform={resolved.platform} className="h-3 w-3" />
                  {PLATFORM_META[resolved.platform].label}
                </Badge>
              ) : null}
              <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]} priority</Badge>
              <Badge tone="accent">{RELATIONSHIP_STATUS_LABELS[relationshipStatus]}</Badge>
            </div>
            {resolved?.followers != null ? (
              <div className="w-full rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <span className="font-semibold">{formatCompact(resolved.followers)}</span>{' '}
                <span className="text-muted-foreground">followers</span>
              </div>
            ) : null}
            {!resolved && !displayName ? (
              <p className="text-xs text-muted-foreground">
                Fill in the form and this card will fill in as you go.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
