'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PLATFORMS } from '@influenceos/shared';
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
import type { QuickAddKind } from './app-context';

const TITLES: Record<QuickAddKind, { title: string; description: string }> = {
  content: { title: 'Add published content', description: 'Paste a public URL — we detect the platform and build the embed.' },
  influencer: { title: 'Add influencer', description: 'Paste a profile URL or enter details manually.' },
  campaign: { title: 'New campaign', description: 'Spin up a campaign for a brand.' },
  cost: { title: 'Add a cost', description: 'Record a campaign expense.' },
  brand: { title: 'Add brand', description: 'Create a new brand workspace.' },
};

export function QuickAdd({
  open,
  kind,
  onOpenChange,
}: {
  open: boolean;
  kind: QuickAddKind;
  onOpenChange: (v: boolean) => void;
}) {
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

function err(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

function AddContent({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const campaigns = useCampaignOptions();
  const [url, setUrl] = React.useState('');
  const [campaignId, setCampaignId] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const content = await api.content.create({ url, campaignId: campaignId || undefined });
      toast.success('Content added to the live wall.');
      qc.invalidateQueries();
      close();
      router.push(`/content/${content.id}`);
    } catch (e) {
      toast.error(err(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Content URL" hint="Instagram, TikTok, YouTube, X or Snapchat">
        <Input placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </Field>
      <Field label="Campaign (optional)">
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger><SelectValue placeholder="Link to a campaign" /></SelectTrigger>
          <SelectContent>
            {campaigns.data?.data.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.brand.name} · {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" disabled={loading}>{loading ? 'Adding…' : 'Add content'}</Button>
    </form>
  );
}

function AddInfluencer({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [input, setInput] = React.useState('');
  const [displayName, setName] = React.useState('');
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
      toast[r.manual ? 'message' : 'success'](r.manual ? 'Manual entry — official data unavailable.' : `Resolved @${r.username} from ${r.platform}.`);
    } catch (e) {
      toast.error(err(e));
    } finally {
      setResolving(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const inf = await api.influencers.create({ displayName: displayName || resolved?.username || input });
      if (resolved) {
        await api.influencers.addSocialAccount(inf.id, {
          platform: resolved.platform as (typeof PLATFORMS)[number],
          username: resolved.username,
          isPrimary: true,
        });
      }
      toast.success('Influencer added.');
      qc.invalidateQueries();
      close();
      router.push(`/influencers/${inf.id}`);
    } catch (e) {
      toast.error(err(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Profile URL or @handle">
        <div className="flex gap-2">
          <Input placeholder="https://instagram.com/creator" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="button" variant="secondary" onClick={resolve} disabled={resolving}>
            {resolving ? 'Resolving…' : 'Resolve'}
          </Button>
        </div>
      </Field>
      {resolved && (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
          <span className="font-medium">{resolved.platform}</span> · @{resolved.username} · source: {resolved.source}
          {resolved.message ? <p className="mt-1 text-muted-foreground">{resolved.message}</p> : null}
        </div>
      )}
      <Field label="Display name">
        <Input value={displayName} onChange={(e) => setName(e.target.value)} placeholder="Full or display name" required />
      </Field>
      <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Add influencer'}</Button>
    </form>
  );
}

function AddCampaign({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const brands = useBrandOptions();
  const [name, setName] = React.useState('');
  const [brandId, setBrandId] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!brandId) return toast.error('Select a brand.');
    setLoading(true);
    try {
      const c = await api.campaigns.create({ brandId, name });
      toast.success('Campaign created.');
      qc.invalidateQueries();
      close();
      router.push(`/campaigns/${c.id}`);
    } catch (e) {
      toast.error(err(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Brand">
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger><SelectValue placeholder="Choose a brand" /></SelectTrigger>
          <SelectContent>
            {brands.data?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Campaign name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer Glow Launch" required />
      </Field>
      <Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create campaign'}</Button>
    </form>
  );
}

function AddCost({ close }: { close: () => void }) {
  const qc = useQueryClient();
  const campaigns = useCampaignOptions();
  const [campaignId, setCampaignId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId) return toast.error('Select a campaign.');
    setLoading(true);
    try {
      await api.campaigns.addExpense(campaignId, { type: 'PRODUCTION', amount: Number(amount), label });
      toast.success('Cost recorded.');
      qc.invalidateQueries();
      close();
    } catch (e) {
      toast.error(err(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Campaign">
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger><SelectValue placeholder="Choose a campaign" /></SelectTrigger>
          <SelectContent>
            {campaigns.data?.data.map((c) => <SelectItem key={c.id} value={c.id}>{c.brand.name} · {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Photoshoot" /></Field>
      <Field label="Amount (KWD)"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
      <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Add cost'}</Button>
    </form>
  );
}

function AddBrand({ close }: { close: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [color, setColor] = React.useState('#6366F1');
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const b = await api.brands.create({ name, description, primaryColor: color });
      toast.success('Brand created.');
      qc.invalidateQueries();
      close();
      router.push(`/brands/${b.slug}`);
    } catch (e) {
      toast.error(err(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Brand name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Primary color">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded-lg border border-border bg-surface" />
      </Field>
      <Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create brand'}</Button>
    </form>
  );
}
