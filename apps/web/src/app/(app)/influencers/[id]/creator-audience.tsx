'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, FileText, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { AudienceInsightDTO, AudienceReadDTO, SocialAccountDTO } from '@influenceos/contracts';
import { PLATFORM_META, businessDateKey, startOfBusinessDay } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useAiStatus } from '@/lib/ai-status';
import { toBrowserUrl, uploadAttachment } from '@/lib/upload';
import { GULF_COUNTRY_CODES, useCountryName, useSortedCountries } from '@/lib/country-names';
import { useLocalizedFormat } from '@/lib/format';
import { enumLabel } from '@/lib/enum-labels';
import { useApp } from '@/components/shell/app-context';
import { LtrText } from '@/components/common/bidi-text';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PlatformBadge } from '@/components/ui/platform-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AGE_KEYS = [
  ['age13to17Pct', '13–17'],
  ['age18to24Pct', '18–24'],
  ['age25to34Pct', '25–34'],
  ['age35to44Pct', '35–44'],
  ['age45PlusPct', '45+'],
] as const;
type AgeKey = (typeof AGE_KEYS)[number][0];

/** Shares that should add to 100 may be a little over from rounding (same slack as the API). */
const PCT_SLACK = 100.5;
const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/**
 * Who follows each of a creator's accounts (P3.7): top countries, women and
 * men, age groups and engagement, typed from the creator's insights
 * screenshot. The newest record per account is what the directory filters on.
 */
export function CreatorAudience({
  influencerId,
  influencerName,
  accounts,
}: {
  influencerId: string;
  influencerName: string;
  accounts: SocialAccountDTO[];
}) {
  const t = useTranslations('influencers.audienceInsights');
  const tCommon = useTranslations('common');
  const { can } = useApp();
  const canManage = can('INFLUENCERS_MANAGE');
  const queryClient = useQueryClient();
  const { shortDate } = useLocalizedFormat();
  const [editing, setEditing] = React.useState<AudienceInsightDTO | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<AudienceInsightDTO | null>(null);

  const query = useQuery({
    queryKey: qk.influencer.audience(influencerId),
    queryFn: () => api.audience.forInfluencer(influencerId),
  });
  const insights = query.data ?? [];
  const latest = insights.filter((i) => i.isLatest);

  const remove = useMutation({
    mutationFn: (id: string) => api.audience.remove(id),
    onSuccess: () => {
      toast.success(t('removedToast'));
      queryClient.invalidateQueries({ queryKey: qk.influencer.audience(influencerId) });
      setRemoving(null);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  async function openDocument(id: string) {
    try {
      const file = await api.files.get(id);
      window.open(toBrowserUrl(file.downloadUrl), '_blank', 'noreferrer');
    } catch (e) {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
    }
  }

  return (
    <Card className="h-fit" id="audience">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t('title')}</CardTitle>
          {canManage && accounts.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> {t('add')}
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{t('description')}</p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>
        ) : accounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noAccounts')}</p>
        ) : latest.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <div className="divide-border divide-y">
            {latest.map((insight) => {
              const earlier = insights.filter(
                (i) => !i.isLatest && i.socialAccountId === insight.socialAccountId,
              );
              return (
                <section
                  key={insight.id}
                  aria-label={`@${insight.username}`}
                  className="space-y-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                      <PlatformBadge platform={insight.platform} size="sm" />
                      <LtrText className="font-medium">@{insight.username}</LtrText>
                      <span className="text-muted-foreground text-xs">
                        {t('asOf', { date: shortDate(insight.capturedAt) })}
                      </span>
                    </div>
                    <RowActions
                      insight={insight}
                      canManage={canManage}
                      onOpen={openDocument}
                      onEdit={() => setEditing(insight)}
                      onRemove={() => setRemoving(insight)}
                    />
                  </div>
                  <InsightBody insight={insight} />
                  {earlier.length > 0 ? (
                    <details className="text-sm">
                      <summary className="text-muted-foreground cursor-pointer text-xs">
                        {t('earlier', { count: earlier.length })}
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {earlier.map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground text-xs">
                              {shortDate(e.capturedAt)}
                              {e.countries[0]
                                ? ` · ${e.countries[0].countryCode} ${pctText(e.countries[0].pct)}`
                                : ''}
                            </span>
                            <RowActions
                              insight={e}
                              canManage={canManage}
                              onOpen={openDocument}
                              onEdit={() => setEditing(e)}
                              onRemove={() => setRemoving(e)}
                            />
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
      <AudienceDialog
        influencerId={influencerId}
        influencerName={influencerName}
        accounts={accounts}
        insight={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeTitle')}
        description={
          removing
            ? t('removeDescription', {
                date: shortDate(removing.capturedAt),
                username: removing.username,
              })
            : undefined
        }
        confirmLabel={t('remove')}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

function RowActions({
  insight,
  canManage,
  onOpen,
  onEdit,
  onRemove,
}: {
  insight: AudienceInsightDTO;
  canManage: boolean;
  onOpen: (id: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('influencers.audienceInsights');
  return (
    <div className="flex shrink-0 items-center gap-1">
      {insight.document ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('openScreenshot')}
          title={t('openScreenshot')}
          onClick={() => onOpen(insight.document!.id)}
        >
          <FileText className="h-4 w-4" />
        </Button>
      ) : null}
      {canManage ? (
        <>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('edit')}
            title={t('edit')}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('remove')}
            title={t('remove')}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function Bar({
  label,
  pct,
  className,
}: {
  label: React.ReactNode;
  pct: number;
  className?: string;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-2 text-xs">
      <span className="truncate">{label}</span>
      <span className="bg-surface-muted h-2 overflow-hidden rounded-full">
        <span
          className={cn('bg-brand block h-full rounded-full', className)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
      <span className="text-end tabular-nums">{pctText(pct)}</span>
    </li>
  );
}

function InsightBody({ insight }: { insight: AudienceInsightDTO }) {
  const t = useTranslations('influencers.audienceInsights');
  const tEnums = useTranslations('enums');
  const name = useCountryName();
  const ages = AGE_KEYS.filter(([k]) => insight.ages[k] != null);
  const hasGender = insight.femalePct != null || insight.malePct != null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {insight.countries.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">{t('topCountries')}</p>
          <ul className="space-y-1">
            {insight.countries.map((c) => (
              <Bar key={c.countryCode} label={name(c.countryCode)} pct={c.pct} />
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-3">
        {hasGender ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium">{t('gender')}</p>
            <ul className="space-y-1">
              {insight.femalePct != null ? (
                <Bar label={t('women')} pct={insight.femalePct} />
              ) : null}
              {insight.malePct != null ? (
                <Bar label={t('men')} pct={insight.malePct} className="bg-accent" />
              ) : null}
            </ul>
          </div>
        ) : null}
        {ages.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium">{t('ages')}</p>
            <ul className="space-y-1">
              {ages.map(([k, label]) => (
                <Bar
                  key={k}
                  label={<LtrText>{label}</LtrText>}
                  pct={insight.ages[k]!}
                  className="bg-info"
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs sm:col-span-2">
        {enumLabel(tEnums, 'audienceSource', insight.source)}
        {insight.engagementRate != null
          ? ` · ${t('engagement', { rate: insight.engagementRate })}`
          : ''}
        {insight.notes ? ` · ${insight.notes}` : ''}
      </p>
    </div>
  );
}

type CountryRow = { key: number; code: string; pct: string };

function AudienceDialog({
  influencerId,
  influencerName,
  accounts,
  insight,
  open,
  onOpenChange,
}: {
  influencerId: string;
  influencerName: string;
  accounts: SocialAccountDTO[];
  insight: AudienceInsightDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('influencers.audienceInsights');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const name = useCountryName();
  const all = useSortedCountries();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const nextKey = React.useRef(0);

  const [accountId, setAccountId] = React.useState('');
  const [date, setDate] = React.useState('');
  const [rows, setRows] = React.useState<CountryRow[]>([]);
  const [women, setWomen] = React.useState('');
  const [men, setMen] = React.useState('');
  const [ages, setAges] = React.useState<Record<AgeKey, string>>({
    age13to17Pct: '',
    age18to24Pct: '',
    age25to34Pct: '',
    age35to44Pct: '',
    age45PlusPct: '',
  });
  const [er, setEr] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [doc, setDoc] = React.useState<{ id: string; fileName: string; isImage: boolean } | null>(
    null,
  );
  const [uploading, setUploading] = React.useState(false);
  const locale = useLocale();
  const readScreenshots = useAiStatus().data?.readScreenshots === true;
  const [read, setRead] = React.useState<{ result: AudienceReadDTO; filled: number } | null>(null);

  const str = (n: number | null | undefined) => (n == null ? '' : String(n));
  React.useEffect(() => {
    if (!open) return;
    setAccountId(
      insight?.socialAccountId ?? accounts.find((a) => a.isPrimary)?.id ?? accounts[0]?.id ?? '',
    );
    setDate(businessDateKey(insight?.capturedAt ?? new Date().toISOString()));
    const initial = insight?.countries.length
      ? insight.countries.map((c) => ({
          key: nextKey.current++,
          code: c.countryCode,
          pct: str(c.pct),
        }))
      : [{ key: nextKey.current++, code: 'KW', pct: '' }];
    setRows(initial);
    setWomen(str(insight?.femalePct));
    setMen(str(insight?.malePct));
    setAges({
      age13to17Pct: str(insight?.ages.age13to17Pct),
      age18to24Pct: str(insight?.ages.age18to24Pct),
      age25to34Pct: str(insight?.ages.age25to34Pct),
      age35to44Pct: str(insight?.ages.age35to44Pct),
      age45PlusPct: str(insight?.ages.age45PlusPct),
    });
    setEr(str(insight?.engagementRate));
    setNotes(insight?.notes ?? '');
    setDoc(
      insight?.document
        ? {
            id: insight.document.id,
            fileName: insight.document.fileName,
            isImage: insight.document.mimeType.startsWith('image/'),
          }
        : null,
    );
    setRead(null);
    // Resets when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, insight]);

  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const gulf = GULF_COUNTRY_CODES as readonly string[];
  const others = all.filter((c) => !gulf.includes(c.code));

  async function pickFile(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(file, { influencerId });
      setDoc({ id: uploaded.id, fileName: uploaded.fileName, isImage: uploaded.isImage });
      setRead(null);
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
    } catch (e) {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // AI (when an admin turned screenshot reading on): fill the form from the
  // attached screenshot for a person to check — nothing is saved here.
  const readShot = useMutation({
    mutationFn: () =>
      api.audience.readScreenshot(influencerId, {
        attachmentId: doc!.id,
        socialAccountId: accountId || null,
        locale: locale.startsWith('ar') ? 'ar' : 'en',
      }),
    onSuccess: (r) => {
      const v = r.values;
      let filled = 0;
      if (v.countries.length) {
        setRows(
          v.countries.map((c) => ({ key: nextKey.current++, code: c.countryCode, pct: str(c.pct) })),
        );
        filled += v.countries.length;
      }
      if (v.femalePct != null) {
        setWomen(str(v.femalePct));
        filled += 1;
      }
      if (v.malePct != null) {
        setMen(str(v.malePct));
        filled += 1;
      }
      const ageValues = Object.entries(v.ages).filter(([, n]) => n != null) as [AgeKey, number][];
      if (ageValues.length) {
        setAges((prev) => {
          const next = { ...prev };
          for (const [k, n] of ageValues) next[k] = str(n);
          return next;
        });
        filled += ageValues.length;
      }
      if (v.engagementRate != null) {
        setEr(str(v.engagementRate));
        filled += 1;
      }
      if (r.capturedOn) setDate(r.capturedOn);
      setRead({ result: r, filled });
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
    onError: (e) => {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const countries = rows
        .filter((r) => r.code && r.pct.trim() !== '')
        .map((r) => ({ countryCode: r.code, pct: Number(r.pct) }));
      const sum = (xs: (number | null)[]) => xs.reduce<number>((n, x) => n + (x ?? 0), 0);
      if (date > businessDateKey(new Date().toISOString())) throw new Error(t('errors.future'));
      if (new Set(countries.map((c) => c.countryCode)).size !== countries.length)
        throw new Error(t('errors.countriesRepeated'));
      if (sum(countries.map((c) => c.pct)) > PCT_SLACK) throw new Error(t('errors.countriesOver'));
      if (sum([num(women), num(men)]) > PCT_SLACK) throw new Error(t('errors.genderOver'));
      if (sum(AGE_KEYS.map(([k]) => num(ages[k]))) > PCT_SLACK)
        throw new Error(t('errors.agesOver'));
      const body = {
        capturedAt: startOfBusinessDay(date),
        countries,
        femalePct: num(women),
        malePct: num(men),
        age13to17Pct: num(ages.age13to17Pct),
        age18to24Pct: num(ages.age18to24Pct),
        age25to34Pct: num(ages.age25to34Pct),
        age35to44Pct: num(ages.age35to44Pct),
        age45PlusPct: num(ages.age45PlusPct),
        engagementRate: num(er),
        attachmentId: doc?.id ?? null,
        notes: notes.trim() || null,
      };
      return insight ? api.audience.update(insight.id, body) : api.audience.create(accountId, body);
    },
    onSuccess: () => {
      toast.success(insight ? t('updatedToast') : t('addedToast'));
      queryClient.invalidateQueries({ queryKey: qk.influencer.audience(influencerId) });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const pctInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    className?: string,
  ) => (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      max={100}
      step="0.1"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      dir="ltr"
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{insight ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription', { name: influencerName })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('fields.account')}>
            <Select value={accountId} onValueChange={setAccountId} disabled={insight != null}>
              <SelectTrigger aria-label={t('fields.account')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span dir="ltr">@{a.username}</span> · {PLATFORM_META[a.platform].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.capturedAt')}>
            <Input
              type="date"
              value={date}
              aria-label={t('fields.capturedAt')}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">{t('fields.countries')}</legend>
            {rows.map((row, i) => (
              <div key={row.key} className="flex items-center gap-2">
                <Select
                  value={row.code}
                  onValueChange={(code) =>
                    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, code } : r)))
                  }
                >
                  <SelectTrigger aria-label={`${t('fields.country')} ${i + 1}`} className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {gulf.map((code) => (
                      <SelectItem key={code} value={code}>
                        {name(code)}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    {others.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pctInput(
                  `${t('fields.share')} ${i + 1}`,
                  row.pct,
                  (pct) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, pct } : r))),
                  'w-24',
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('fields.removeCountry')}
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {rows.length < 10 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setRows((rs) => [
                    ...rs,
                    {
                      key: nextKey.current++,
                      code: GULF_COUNTRY_CODES.find((c) => !rs.some((r) => r.code === c)) ?? '',
                      pct: '',
                    },
                  ])
                }
              >
                <Plus className="h-4 w-4" /> {t('fields.addCountry')}
              </Button>
            ) : null}
          </fieldset>

          <Field label={t('fields.women')} hint={t('optional')}>
            {pctInput(t('fields.women'), women, setWomen)}
          </Field>
          <Field label={t('fields.men')} hint={t('optional')}>
            {pctInput(t('fields.men'), men, setMen)}
          </Field>

          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">{t('fields.ages')}</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {AGE_KEYS.map(([k, label]) => (
                <label key={k} className="space-y-1 text-xs">
                  <span className="text-muted-foreground block" dir="ltr">
                    {label}
                  </span>
                  {pctInput(`${t('fields.ages')} ${label}`, ages[k], (v) =>
                    setAges((a) => ({ ...a, [k]: v })),
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label={t('fields.engagementRate')} hint={t('optional')}>
            {pctInput(t('fields.engagementRate'), er, setEr)}
          </Field>
          <Field label={t('fields.screenshot')}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
            />
            {doc ? (
              <div className="space-y-2">
                <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('fields.removeScreenshot')}
                    onClick={() => {
                      setDoc(null);
                      setRead(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {readScreenshots && doc.isImage ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-fit"
                    disabled={readShot.isPending}
                    onClick={() => readShot.mutate()}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {readShot.isPending ? t('ai.reading') : t('ai.read')}
                  </Button>
                ) : null}
                {read ? (
                  <div role="status" className="bg-surface-muted space-y-1 rounded-lg p-2.5 text-xs">
                    {read.result.looksLikeAudience ? (
                      <p className="font-medium">{t('ai.filled', { count: read.filled })}</p>
                    ) : (
                      <p className="text-warning flex items-center gap-1.5 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t('ai.notAudience')}
                      </p>
                    )}
                    {read.result.capturedOn ? (
                      <p className="text-muted-foreground">{t('ai.dateFromShot')}</p>
                    ) : null}
                    {read.result.note ? (
                      <p className="text-muted-foreground" dir="auto">
                        {read.result.note}
                      </p>
                    ) : null}
                    {read.result.remaining != null ? (
                      <p className="text-muted-foreground">
                        {t('ai.remaining', { count: read.result.remaining })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />{' '}
                {uploading ? t('fields.uploading') : t('fields.upload')}
              </Button>
            )}
          </Field>
          <Field label={t('fields.notes')} hint={t('optional')} className="sm:col-span-2">
            <Textarea
              value={notes}
              aria-label={t('fields.notes')}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!accountId || !date || save.isPending || uploading}>
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
