'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CalendarRange, Megaphone, Sparkles, Wallet } from 'lucide-react';
import {
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_STATUSES,
  type CampaignObjective,
  type CampaignStatus,
} from '@influenceos/shared';
import type { BrandSummaryDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CampaignStatusBadge } from '@/components/ui/status-badges';
import { Spinner } from '@/components/ui/spinner';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';

/** Sentinel for the objective Select's "no objective" option (Radix forbids an empty-string item value). */
const NO_OBJECTIVE = 'none';

export interface NewCampaignFormProps {
  brands: BrandSummaryDTO[];
}

interface FormState {
  brandId: string;
  name: string;
  objective: string;
  status: CampaignStatus;
  startDate: string;
  endDate: string;
  currency: string;
  plannedBudget: string;
  targetMarket: string;
  description: string;
  brief: string;
}

const initialState: FormState = {
  brandId: '',
  name: '',
  objective: NO_OBJECTIVE,
  status: 'DRAFT',
  startDate: '',
  endDate: '',
  currency: 'KWD',
  plannedBudget: '',
  targetMarket: '',
  description: '',
  brief: '',
};

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** Multi-section "new campaign" form: brand + basics, timeline & budget, and brief — with a live preview aside. */
export function NewCampaignForm({ brands }: NewCampaignFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [form, setForm] = React.useState<FormState>(initialState);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const createCampaign = useMutation({
    mutationFn: () => {
      const name = form.name.trim();
      const budget = form.plannedBudget.trim();
      return api.campaigns.create({
        brandId: form.brandId,
        name,
        objective: form.objective === NO_OBJECTIVE ? undefined : (form.objective as CampaignObjective),
        status: form.status,
        startDate: form.startDate ? new Date(form.startDate) : undefined,
        endDate: form.endDate ? new Date(form.endDate) : undefined,
        currency: form.currency.trim() || 'KWD',
        plannedBudget: budget ? Number(budget) : undefined,
        targetMarket: form.targetMarket.trim() || undefined,
        description: form.description.trim() || undefined,
        brief: form.brief.trim() || undefined,
      });
    },
    onSuccess: (campaign) => {
      toast.success(t('newForm.createdToast', { name: campaign.name }));
      queryClient.invalidateQueries();
      router.push(`/campaigns/${campaign.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  const selectedBrand = brands.find((b) => b.id === form.brandId) ?? null;
  const canSubmit = form.brandId !== '' && form.name.trim().length > 0 && !createCampaign.isPending;
  const dateRangeInvalid = Boolean(form.startDate && form.endDate && form.endDate < form.startDate);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (dateRangeInvalid) {
      toast.error(t('newForm.dateRangeError'));
      return;
    }
    createCampaign.mutate();
  }

  if (brands.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title={t('newForm.noBrandsTitle')}
        description={t('newForm.noBrandsDescription')}
      />
    );
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
              <CardTitle>{t('newForm.basicsTitle')}</CardTitle>
            </div>
            <CardDescription>{t('newForm.basicsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 pt-5 sm:grid-cols-2">
            <Field label={t('fields.brand')}>
              <Select value={form.brandId} onValueChange={(v) => set('brandId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('newForm.selectBrandPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      <BidiText>{brand.name}</BidiText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('newForm.campaignNameLabel')}>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('newForm.campaignNamePlaceholder')}
                required
              />
            </Field>

            <Field label={t('fields.objective')}>
              <Select value={form.objective} onValueChange={(v) => set('objective', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OBJECTIVE}>{t('newForm.noObjectiveSet')}</SelectItem>
                  {CAMPAIGN_OBJECTIVES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {enumLabel(tEnums, 'campaignObjective', o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('fields.status')}>
              <Select value={form.status} onValueChange={(v) => set('status', v as CampaignStatus)}>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5 border-b border-border pb-5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                2
              </span>
              <CardTitle>{t('newForm.timelineBudgetTitle')}</CardTitle>
            </div>
            <CardDescription>{t('newForm.timelineBudgetDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 pt-5 sm:grid-cols-2">
            <Field label={t('fields.startDate')}>
              <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label={t('fields.endDate')} error={dateRangeInvalid ? t('newForm.endDateError') : undefined}>
              <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>

            <Field label={t('fields.currency')}>
              <Input
                value={form.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                placeholder={t('newForm.currencyPlaceholder')}
                maxLength={8}
              />
            </Field>
            <Field label={t('fields.plannedBudget')}>
              <Input
                type="number"
                min={0}
                step="0.001"
                inputMode="decimal"
                value={form.plannedBudget}
                onChange={(e) => set('plannedBudget', e.target.value)}
                placeholder="0.000"
              />
            </Field>

            <Field label={t('fields.targetMarket')} className="sm:col-span-2" hint={t('newForm.targetMarketHint')}>
              <Input
                value={form.targetMarket}
                onChange={(e) => set('targetMarket', e.target.value)}
                placeholder={t('newForm.targetMarketPlaceholder')}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1.5 border-b border-border pb-5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                3
              </span>
              <CardTitle>{t('newForm.descriptionBriefTitle')}</CardTitle>
            </div>
            <CardDescription>{t('newForm.descriptionBriefDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-5">
            <Field label={t('fields.description')} hint={t('newForm.descriptionHint')}>
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={t('newForm.descriptionPlaceholder')}
                rows={3}
              />
            </Field>
            <Field label={t('newForm.creativeBriefLabel')} hint={t('newForm.creativeBriefHint')}>
              <Textarea
                value={form.brief}
                onChange={(e) => set('brief', e.target.value)}
                placeholder={t('newForm.creativeBriefPlaceholder')}
                rows={5}
              />
            </Field>
          </CardContent>
          <CardFooter className="justify-end gap-3 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/campaigns')}
              disabled={createCampaign.isPending}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createCampaign.isPending ? <Spinner className="text-current" /> : <Megaphone className="h-4 w-4" />}
              {createCampaign.isPending ? t('newForm.creating') : t('newForm.createCampaign')}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <aside className="lg:sticky lg:top-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('newForm.previewTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="flex items-start gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-semibold text-white shadow-soft"
                style={{ backgroundColor: selectedBrand?.primaryColor ?? 'hsl(var(--brand))' }}
              >
                {selectedBrand ? selectedBrand.name.slice(0, 1).toUpperCase() : <Sparkles className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold leading-tight">
                  <BidiText>{form.name.trim() || t('newForm.untitledCampaign')}</BidiText>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {selectedBrand ? <BidiText>{selectedBrand.name}</BidiText> : t('newForm.noBrandSelected')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <CampaignStatusBadge status={form.status} />
              {form.objective !== NO_OBJECTIVE ? (
                <Badge tone="accent">
                  {enumLabel(tEnums, 'campaignObjective', form.objective as CampaignObjective)}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2 rounded-xl bg-surface-muted px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" /> {t('fields.timeline')}
                </span>
                <span className="text-right font-medium">
                  {form.startDate || form.endDate
                    ? `${form.startDate || '—'} → ${form.endDate || '—'}`
                    : t('fields.notSet')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" /> {t('fields.budget')}
                </span>
                <span className="font-medium">
                  {form.plannedBudget.trim()
                    ? formatCurrency(Number(form.plannedBudget), form.currency.trim() || 'KWD')
                    : t('fields.notSet')}
                </span>
              </div>
            </div>

            {!selectedBrand && !form.name ? (
              <p className="text-xs text-muted-foreground">{t('newForm.previewHint')}</p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
