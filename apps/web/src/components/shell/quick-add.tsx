'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { COUNTRIES, PLATFORMS } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { ApiError } from '@influenceos/api-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AddContentFlow } from '@/components/content/add-content-flow';
import { BidiText } from '@/components/common/bidi-text';
import type { QuickAddKind } from './app-context';

export function QuickAdd({
  open,
  kind,
  onOpenChange,
}: {
  open: boolean;
  kind: QuickAddKind;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('common');
  const TITLES: Record<QuickAddKind, { title: string; description: string }> = {
    content: { title: t('addPublishedContentTitle'), description: t('addPublishedContentDescription') },
    influencer: { title: t('addInfluencerTitle'), description: t('addInfluencerDescription') },
    campaign: { title: t('newCampaignTitle'), description: t('newCampaignDescription') },
    cost: { title: t('addCostTitle'), description: t('addCostDescription') },
    brand: { title: t('addBrandTitle'), description: t('addBrandDescription') },
  };
  const meta = TITLES[kind];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>
        {kind === 'content' && <AddContent close={() => onOpenChange(false)} />}
        {kind === 'influencer' && <AddInfluencer close={() => onOpenChange(false)} />}
        {kind === 'campaign' && <AddCampaign close={() => onOpenChange(false)} />}
        {kind === 'cost' && <AddCost close={() => onOpenChange(false)} />}
        {kind === 'brand' && <AddBrand close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function useCampaignOptions() {
  return useQuery({ queryKey: ['campaigns', 'options'], queryFn: () => api.campaigns.list({ pageSize: 100 }) });
}
function useBrandOptions() {
  return useQuery({ queryKey: ['brands', 'options'], queryFn: () => api.brands.list() });
}

/** `fallback` is the caller's already-resolved `common.somethingWentWrong` — kept
 * as a plain helper (not a hook) since it's called from event handlers, not render. */
function err(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function AddContent({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <AddContentFlow
      onCancel={close}
      onSuccess={(content) => {
        qc.invalidateQueries();
        close();
        router.push(`/content/${content.id}`);
      }}
    />
  );
}

function AddInfluencer({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('common');
  const [input, setInput] = React.useState('');
  const [displayName, setName] = React.useState('');
  const [countryCode, setCountryCode] = React.useState('');
  const [resolving, setResolving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [resolved, setResolved] = React.useState<{ platform: string; username: string; source: string; message: string | null } | null>(null);

  async function resolve() {
    if (!input.trim()) return;
    setResolving(true);
    try {
      const r = await api.influencers.resolve({ input });
      setResolved({ platform: r.platform, username: r.username, source: r.source, message: r.message });
      if (r.displayName) setName(r.displayName);
      else if (!displayName) setName(r.username);
      toast[r.manual ? 'message' : 'success'](
        r.manual ? t('manualEntryUnavailable') : t('resolvedFrom', { username: r.username, platform: r.platform }),
      );
    } catch (e) {
      toast.error(err(e, t('somethingWentWrong')));
    } finally {
      setResolving(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!countryCode) {
      toast.error(t('countryRequiredToast'));
      return;
    }
    setLoading(true);
    try {
      const inf = await api.influencers.create({ displayName: displayName || resolved?.username || input, countryCode });
      if (resolved) {
        await api.influencers.addSocialAccount(inf.id, {
          platform: resolved.platform as (typeof PLATFORMS)[number],
          username: resolved.username,
          isPrimary: true,
        });
      }
      toast.success(t('influencerAdded'));
      qc.invalidateQueries();
      close();
      router.push(`/influencers/${inf.id}`);
    } catch (e) {
      toast.error(err(e, t('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('profileUrlOrHandle')}>
        <div className="flex gap-2">
          <Input placeholder="https://instagram.com/creator" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="button" variant="secondary" onClick={resolve} disabled={resolving}>
            {resolving ? t('resolving') : t('resolve')}
          </Button>
        </div>
      </Field>
      {resolved && (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
          <span className="font-medium">{resolved.platform}</span> · <BidiText as="span">@{resolved.username}</BidiText> · {t('source')}: {resolved.source}
          {resolved.message ? <p className="mt-1 text-muted-foreground">{resolved.message}</p> : null}
        </div>
      )}
      <Field label={t('displayName')}>
        <Input value={displayName} onChange={(e) => setName(e.target.value)} placeholder={t('fullOrDisplayName')} required />
      </Field>
      <Field label={t('influencerCountry')} hint={t('countryRequiredHint')}>
        <Select value={countryCode} onValueChange={setCountryCode}>
          <SelectTrigger><SelectValue placeholder={t('selectCountry')} /></SelectTrigger>
          <SelectContent className="max-h-72">
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" disabled={loading}>{loading ? t('saving') : t('addInfluencerTitle')}</Button>
    </form>
  );
}

function AddCampaign({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const brands = useBrandOptions();
  const t = useTranslations('common');
  const [name, setName] = React.useState('');
  const [brandId, setBrandId] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!brandId) return toast.error(t('selectBrandRequired'));
    setLoading(true);
    try {
      const c = await api.campaigns.create({ brandId, name });
      toast.success(t('campaignCreated'));
      qc.invalidateQueries();
      close();
      router.push(`/campaigns/${c.id}`);
    } catch (e) {
      toast.error(err(e, t('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('brand')}>
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger><SelectValue placeholder={t('chooseBrand')} /></SelectTrigger>
          <SelectContent>
            {brands.data?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('campaignName')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer Glow Launch" required />
      </Field>
      <Button type="submit" disabled={loading}>{loading ? t('creating') : t('createCampaign')}</Button>
    </form>
  );
}

function AddCost({ close }: { close: () => void }) {
  const qc = useQueryClient();
  const campaigns = useCampaignOptions();
  const t = useTranslations('common');
  const [campaignId, setCampaignId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId) return toast.error(t('selectCampaignRequired'));
    setLoading(true);
    try {
      await api.campaigns.addExpense(campaignId, { type: 'PRODUCTION', amount: Number(amount), label });
      toast.success(t('costRecorded'));
      qc.invalidateQueries();
      close();
    } catch (e) {
      toast.error(err(e, t('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('campaign')}>
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger><SelectValue placeholder={t('chooseCampaign')} /></SelectTrigger>
          <SelectContent>
            {campaigns.data?.data.map((c) => <SelectItem key={c.id} value={c.id}>{c.brand.name} · {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('costLabel')}><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Photoshoot" /></Field>
      <Field label={t('amountKwd')}><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
      <Button type="submit" disabled={loading}>{loading ? t('saving') : t('addCostTitle')}</Button>
    </form>
  );
}

function AddBrand({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('common');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [color, setColor] = React.useState('#6366F1');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const b = await api.brands.create({ name, description, primaryColor: color });
      toast.success(t('brandCreated'));
      qc.invalidateQueries();
      close();
      router.push(`/brands/${b.slug}`);
    } catch (e) {
      toast.error(err(e, t('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('brandName')}><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label={t('description')}><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label={t('primaryColor')}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded-lg border border-border bg-surface" />
      </Field>
      <Button type="submit" disabled={loading}>{loading ? t('creating') : t('createBrandButton')}</Button>
    </form>
  );
}
