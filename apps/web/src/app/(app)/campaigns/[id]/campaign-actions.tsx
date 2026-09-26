'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, FileBarChart, Pencil } from 'lucide-react';
import type { CampaignDetailDTO, CampaignObjective, CampaignStatus } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { CAMPAIGN_OBJECTIVES, CAMPAIGN_STATUSES } from '@influenceos/shared';
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
import { Switch } from '@/components/ui/switch';

/** Sentinel for "no objective" in the Select (Radix forbids an empty-string value). */
const NONE = 'none';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;
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
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);

  const changeStatus = useMutation({
    mutationFn: (status: CampaignStatus) => api.campaigns.update(campaign.id, { status }),
    onSuccess: () => {
      toast.success(t('actions.statusUpdatedToast'));
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A full page load: the report is a standalone document (see report-toolbar.tsx). */}
      <Button variant="outline" size="sm" asChild>
        <a href={`/campaigns/${campaign.id}/report`}>
          <FileBarChart className="h-3.5 w-3.5" /> {t('clientReport.buttonLabel')}
        </a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={changeStatus.isPending}>
            {t('actions.changeStatus')} <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('actions.setStatus')}</DropdownMenuLabel>
          {CAMPAIGN_STATUSES.map((s) => (
            <DropdownMenuItem
              key={s}
              disabled={s === campaign.status}
              onSelect={() => changeStatus.mutate(s)}
            >
              {enumLabel(tEnums, 'campaignStatus', s)}
              {s === campaign.status ? ` ${t('actions.currentSuffix')}` : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> {t('actions.editCampaign')}
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
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
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
  const [draftReview, setDraftReview] = React.useState(campaign.draftReview);
  const numText = (v: number | null) => (v != null ? String(v) : '');
  const [targetViews, setTargetViews] = React.useState(numText(campaign.targetViews));
  const [targetEngagements, setTargetEngagements] = React.useState(numText(campaign.targetEngagements));
  const [targetRate, setTargetRate] = React.useState(numText(campaign.targetEngagementRate));
  const [targetCpv, setTargetCpv] = React.useState(numText(campaign.targetCostPerView));
  const [reportSummary, setReportSummary] = React.useState(campaign.reportSummary ?? '');

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
      setDraftReview(campaign.draftReview);
      setTargetViews(numText(campaign.targetViews));
      setTargetEngagements(numText(campaign.targetEngagements));
      setTargetRate(numText(campaign.targetEngagementRate));
      setTargetCpv(numText(campaign.targetCostPerView));
      setReportSummary(campaign.reportSummary ?? '');
    }
    // numText is a pure helper recreated each render; the campaign is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign]);

  const save = useMutation({
    mutationFn: () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t('actions.enterNameError'));
      const budget = plannedBudget.trim();
      if (budget !== '' && !Number.isFinite(Number(budget))) {
        throw new Error(t('actions.invalidBudgetError'));
      }
      // Targets accept "1.2m", "250k" and thousands separators.
      const parseTarget = (v: string, integer: boolean): number | null => {
        const s = v.trim().toLowerCase().replace(/,/g, '');
        if (!s) return null;
        const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
        if (!m) throw new Error(t('actions.invalidTargetError'));
        const n = Number(m[1]) * (m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1);
        return integer ? Math.round(n) : n;
      };
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
        draftReview,
        targetViews: parseTarget(targetViews, true),
        targetEngagements: parseTarget(targetEngagements, true),
        targetEngagementRate: parseTarget(targetRate, false),
        targetCostPerView: parseTarget(targetCpv, false),
        reportSummary: reportSummary.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('actions.updatedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('actions.editCampaign')}</DialogTitle>
          <DialogDescription>{t('actions.editDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('actions.nameLabel')} className="col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newForm.campaignNameLabel')} />
          </Field>
          <Field label={t('fields.status')}>
            <Select value={status} onValueChange={(v) => setStatus(v as CampaignStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(tEnums, 'campaignStatus', s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.objective')} hint={t('fields.optionalHint')}>
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('actions.noneOption')}</SelectItem>
                {CAMPAIGN_OBJECTIVES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {enumLabel(tEnums, 'campaignObjective', o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.startDate')} hint={t('fields.optionalHint')}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={t('fields.endDate')} hint={t('fields.optionalHint')}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label={t('fields.plannedBudget')} hint={t('fields.optionalHint')}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={plannedBudget}
              onChange={(e) => setPlannedBudget(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label={t('fields.currency')}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder={t('newForm.currencyPlaceholder')} />
          </Field>
          <Field label={t('fields.targetMarket')} hint={t('fields.optionalHint')} className="col-span-2">
            <Input
              value={targetMarket}
              onChange={(e) => setTargetMarket(e.target.value)}
              placeholder={t('actions.targetMarketPlaceholder')}
            />
          </Field>
          <Field label={t('fields.description')} hint={t('fields.optionalHint')} className="col-span-2">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <Field label={t('newForm.creativeBriefLabel')} hint={t('fields.optionalHint')} className="col-span-2">
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} />
          </Field>
          <label className="col-span-2 flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t('actions.draftReviewLabel')}</span>
              <span className="block text-xs text-muted-foreground">{t('actions.draftReviewHint')}</span>
            </span>
            <Switch checked={draftReview} onCheckedChange={setDraftReview} aria-label={t('actions.draftReviewLabel')} />
          </label>

          <div className="col-span-2 space-y-1 pt-2">
            <p className="text-sm font-semibold">{t('actions.targetsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('actions.targetsHint')}</p>
          </div>
          <Field label={t('actions.targetViewsLabel')} hint={t('fields.optionalHint')}>
            <Input inputMode="decimal" value={targetViews} onChange={(e) => setTargetViews(e.target.value)} placeholder="500k" dir="ltr" />
          </Field>
          <Field label={t('actions.targetEngagementsLabel')} hint={t('fields.optionalHint')}>
            <Input inputMode="decimal" value={targetEngagements} onChange={(e) => setTargetEngagements(e.target.value)} placeholder="25k" dir="ltr" />
          </Field>
          <Field label={t('actions.targetRateLabel')} hint={t('fields.optionalHint')}>
            <Input inputMode="decimal" value={targetRate} onChange={(e) => setTargetRate(e.target.value)} placeholder="4.5" dir="ltr" />
          </Field>
          <Field label={t('actions.targetCpvLabel', { currency: campaign.currency })} hint={t('fields.optionalHint')}>
            <Input inputMode="decimal" value={targetCpv} onChange={(e) => setTargetCpv(e.target.value)} placeholder="0.010" dir="ltr" />
          </Field>
          <Field label={t('actions.reportSummaryLabel')} hint={t('actions.reportSummaryHint')} className="col-span-2">
            <Textarea value={reportSummary} onChange={(e) => setReportSummary(e.target.value)} rows={3} dir="auto" />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? tCommon('saving') : t('workspace.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
