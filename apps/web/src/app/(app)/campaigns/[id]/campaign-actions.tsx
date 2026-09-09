'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Pencil } from 'lucide-react';
import type { CampaignDetailDTO, CampaignObjective, CampaignStatus } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
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
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Sentinel for "no objective" in the Select (Radix forbids an empty-string value). */
const NONE = 'none';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.';
}

function toDateInput(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Campaign-level actions rendered in the workspace hero: a quick lifecycle
 * status changer (addendum item 6) and a full "Edit campaign" dialog.
 */
export function CampaignActions({ campaign }: { campaign: CampaignDetailDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);

  const changeStatus = useMutation({
    mutationFn: (status: CampaignStatus) => api.campaigns.update(campaign.id, { status }),
    onSuccess: () => {
      toast.success('Campaign status updated');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={changeStatus.isPending}>
            Change status <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Set status</DropdownMenuLabel>
          {CAMPAIGN_STATUSES.map((s) => (
            <DropdownMenuItem
              key={s}
              disabled={s === campaign.status}
              onSelect={() => changeStatus.mutate(s)}
            >
              {CAMPAIGN_STATUS_LABELS[s]}
              {s === campaign.status ? ' (current)' : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Edit campaign
      </Button>

      <EditCampaignDialog campaign={campaign} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function EditCampaignDialog({
  campaign,
  open,
  onOpenChange,
}: {
  campaign: CampaignDetailDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState(campaign.name);
  const [status, setStatus] = React.useState<CampaignStatus>(campaign.status);
  const [objective, setObjective] = React.useState<string>(campaign.objective ?? NONE);
  const [startDate, setStartDate] = React.useState(toDateInput(campaign.startDate));
  const [endDate, setEndDate] = React.useState(toDateInput(campaign.endDate));
  const [currency, setCurrency] = React.useState(campaign.currency);
  const [plannedBudget, setPlannedBudget] = React.useState(
    campaign.plannedBudget != null ? String(campaign.plannedBudget) : '',
  );
  const [targetMarket, setTargetMarket] = React.useState(campaign.targetMarket ?? '');
  const [description, setDescription] = React.useState(campaign.description ?? '');
  const [brief, setBrief] = React.useState(campaign.brief ?? '');

  // Reset the form to the campaign each time the dialog is opened.
  React.useEffect(() => {
    if (open) {
      setName(campaign.name);
      setStatus(campaign.status);
      setObjective(campaign.objective ?? NONE);
      setStartDate(toDateInput(campaign.startDate));
      setEndDate(toDateInput(campaign.endDate));
      setCurrency(campaign.currency);
      setPlannedBudget(campaign.plannedBudget != null ? String(campaign.plannedBudget) : '');
      setTargetMarket(campaign.targetMarket ?? '');
      setDescription(campaign.description ?? '');
      setBrief(campaign.brief ?? '');
    }
  }, [open, campaign]);

  const save = useMutation({
    mutationFn: () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('Enter a campaign name.');
      const budget = plannedBudget.trim();
      if (budget !== '' && !Number.isFinite(Number(budget))) {
        throw new Error('Enter a valid budget.');
      }
      return api.campaigns.update(campaign.id, {
        name: trimmedName,
        status,
        objective: objective === NONE ? null : (objective as CampaignObjective),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        currency: currency.trim() || undefined,
        plannedBudget: budget === '' ? null : Number(budget),
        targetMarket: targetMarket.trim() || null,
        description: description.trim() || null,
        brief: brief.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success('Campaign updated');
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Update the campaign details, dates, budget and lifecycle status.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as CampaignStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CAMPAIGN_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Objective" hint="Optional">
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {CAMPAIGN_OBJECTIVES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {CAMPAIGN_OBJECTIVE_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start date" hint="Optional">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date" hint="Optional">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Planned budget" hint="Optional">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={plannedBudget}
              onChange={(e) => setPlannedBudget(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="KWD" />
          </Field>
          <Field label="Target market" hint="Optional" className="col-span-2">
            <Input value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} placeholder="e.g. Kuwait, GCC" />
          </Field>
          <Field label="Description" hint="Optional" className="col-span-2">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <Field label="Creative brief" hint="Optional" className="col-span-2">
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
