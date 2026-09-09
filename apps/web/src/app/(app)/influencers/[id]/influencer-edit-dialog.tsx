'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Pencil } from 'lucide-react';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_STATUS_LABELS,
  type Priority,
  type RelationshipStatus,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
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

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

/** "Edit influencer" trigger + dialog for the 360 profile. Patches the core profile + contact fields. */
export function InfluencerEditDialog({ influencer }: { influencer: InfluencerDetailDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [displayName, setDisplayName] = React.useState(influencer.displayName);
  const [fullName, setFullName] = React.useState(influencer.contact.fullName ?? '');
  const [primaryUsername, setPrimaryUsername] = React.useState(influencer.primaryUsername ?? '');
  const [category, setCategory] = React.useState(influencer.category ?? '');
  const [country, setCountry] = React.useState(influencer.country ?? '');
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
      toast.success(`${updated.displayName} updated.`);
      queryClient.invalidateQueries();
      router.refresh();
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Pencil className="h-4 w-4" /> Edit influencer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit influencer</DialogTitle>
          <DialogDescription>Update this creator&apos;s profile and contact details.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Sara Al-Fahad" />
          </Field>
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Legal name" />
          </Field>

          <Field label="Primary username" hint="Without the @">
            <Input value={primaryUsername} onChange={(e) => setPrimaryUsername(e.target.value)} placeholder="creator" />
          </Field>
          <Field label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Beauty, Fitness, Food…" />
          </Field>

          <Field label="Country">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Kuwait" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Kuwait City" />
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

          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="creator@email.com" />
          </Field>
          <Field label="Mobile">
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+965 …" />
          </Field>

          <Field label="WhatsApp">
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+965 …" />
          </Field>
          <Field label="Languages" hint="Comma-separated">
            <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Arabic, English" />
          </Field>

          <Field label="Tags" hint="Comma-separated" className="sm:col-span-2">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ramadan, macro, ugc" />
          </Field>

          <Field label="Bio" className="sm:col-span-2">
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short bio…" rows={3} />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 sm:col-span-2">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Inactive creators are hidden from active rosters.</p>
            </div>
            <Switch aria-label="Active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button disabled={!displayName.trim() || update.isPending} onClick={() => update.mutate()}>
            {update.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
