'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Pencil } from 'lucide-react';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  COUNTRIES,
  PRIORITIES,
  RELATIONSHIP_STATUSES,
  type Priority,
  type RelationshipStatus,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, Input, Label, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

const NO_COUNTRY = '__none__';

/** "Edit influencer" trigger + dialog for the 360 profile. Patches the core profile + contact fields. */
export function InfluencerEditDialog({ influencer }: { influencer: InfluencerDetailDTO }) {
  const router = useRouter();
  const t = useTranslations('influencers');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const queryClient = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [displayName, setDisplayName] = React.useState(influencer.displayName);
  const [fullName, setFullName] = React.useState(influencer.contact.fullName ?? '');
  const [primaryUsername, setPrimaryUsername] = React.useState(influencer.primaryUsername ?? '');
  const [category, setCategory] = React.useState(influencer.category ?? '');
  const [country, setCountry] = React.useState(influencer.country ?? '');
  const [countryCode, setCountryCode] = React.useState(influencer.countryCode ?? NO_COUNTRY);
  const [city, setCity] = React.useState(influencer.city ?? '');
  const [languages, setLanguages] = React.useState(influencer.languages.join(', '));
  const [email, setEmail] = React.useState(influencer.contact.email ?? '');
  const [mobile, setMobile] = React.useState(influencer.contact.mobile ?? '');
  const [whatsapp, setWhatsapp] = React.useState(influencer.contact.whatsapp ?? '');
  const [priority, setPriority] = React.useState<Priority>(influencer.priority);
  const [relationshipStatus, setRelationshipStatus] = React.useState<RelationshipStatus>(
    influencer.relationshipStatus,
  );
  const [tags, setTags] = React.useState(influencer.tags.join(', '));
  const [bio, setBio] = React.useState(influencer.bio ?? '');
  const [isActive, setIsActive] = React.useState(influencer.isActive);

  // Re-seed from the latest server data whenever the dialog is closed.
  React.useEffect(() => {
    if (open) return;
    setDisplayName(influencer.displayName);
    setFullName(influencer.contact.fullName ?? '');
    setPrimaryUsername(influencer.primaryUsername ?? '');
    setCategory(influencer.category ?? '');
    setCountry(influencer.country ?? '');
    setCountryCode(influencer.countryCode ?? NO_COUNTRY);
    setCity(influencer.city ?? '');
    setLanguages(influencer.languages.join(', '));
    setEmail(influencer.contact.email ?? '');
    setMobile(influencer.contact.mobile ?? '');
    setWhatsapp(influencer.contact.whatsapp ?? '');
    setPriority(influencer.priority);
    setRelationshipStatus(influencer.relationshipStatus);
    setTags(influencer.tags.join(', '));
    setBio(influencer.bio ?? '');
    setIsActive(influencer.isActive);
  }, [influencer, open]);

  const update = useMutation({
    mutationFn: () =>
      api.influencers.update(influencer.id, {
        displayName: displayName.trim(),
        fullName: fullName.trim() || null,
        primaryUsername: primaryUsername.trim() || null,
        category: category.trim() || null,
        country: country.trim() || null,
        // countryCode is required (mandatory since creation) — once set, it
        // can be changed to a different country but never cleared back to
        // "none", so an untouched NO_COUNTRY selection is simply omitted
        // (leaves an existing legacy country-less row as-is) rather than sent as null.
        countryCode: countryCode === NO_COUNTRY ? undefined : countryCode,
        city: city.trim() || null,
        languages: splitList(languages),
        email: email.trim() || null,
        mobile: mobile.trim() || null,
        whatsapp: whatsapp.trim() || null,
        priority,
        relationshipStatus,
        tags: splitList(tags),
        bio: bio.trim() || null,
        isActive,
      }),
    onSuccess: (updated) => {
      toast.success(t('form.edit.updatedToast', { name: updated.displayName }));
      queryClient.invalidateQueries();
      router.refresh();
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Pencil className="h-4 w-4" /> {t('form.edit.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('form.edit.title')}</DialogTitle>
          <DialogDescription>{t('form.edit.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label={t('form.fields.displayName')}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('form.fields.displayNamePlaceholder')} />
          </Field>
          <Field label={t('form.fields.fullName')}>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('form.fields.fullNamePlaceholder')} />
          </Field>

          <Field label={t('form.fields.primaryUsername')} hint={t('form.fields.primaryUsernameHint')}>
            <Input value={primaryUsername} onChange={(e) => setPrimaryUsername(e.target.value)} placeholder={t('form.fields.primaryUsernamePlaceholder')} />
          </Field>
          <Field label={t('form.fields.category')}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('form.fields.categoryPlaceholder')} />
          </Field>

          <Field label={t('form.fields.country')} hint={t('form.fields.countryProfileHint')}>
            <Select
              value={countryCode}
              onValueChange={(v) => {
                setCountryCode(v);
                setCountry(v === NO_COUNTRY ? '' : (COUNTRIES.find((c) => c.code === v)?.name ?? country));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NO_COUNTRY}>{t('form.fields.noCountrySet')}</SelectItem>
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

          <Field label={t('form.fields.email')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('form.fields.emailPlaceholder')} />
          </Field>
          <Field label={t('form.fields.mobile')}>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder={t('form.fields.mobilePlaceholder')} />
          </Field>

          <Field label={t('form.fields.whatsapp')}>
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={t('form.fields.whatsappPlaceholder')} />
          </Field>
          <Field label={t('form.fields.languages')} hint={t('form.fields.languagesHint')}>
            <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder={t('form.fields.languagesPlaceholder')} />
          </Field>

          <Field label={t('form.fields.tags')} hint={t('form.fields.tagsHint')} className="sm:col-span-2">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('form.fields.tagsPlaceholder')} />
          </Field>

          <Field label={t('form.fields.bio')} className="sm:col-span-2">
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('form.fields.bioPlaceholder')} rows={3} />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 sm:col-span-2">
            <div>
              <Label>{t('form.fields.active')}</Label>
              <p className="text-xs text-muted-foreground">{t('form.fields.activeHint')}</p>
            </div>
            <Switch aria-label={t('form.fields.active')} checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={update.isPending}>
            {tc('cancel')}
          </Button>
          <Button disabled={!displayName.trim() || update.isPending} onClick={() => update.mutate()}>
            {update.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {update.isPending ? tc('saving') : t('form.edit.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
