'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Gauge, KeyRound, Sparkles } from 'lucide-react';
import type { AiSettingsDTO, AiStatusDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { LtrText } from '@/components/common/bidi-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

type Form = {
  enabled: boolean;
  model: string;
  monthlyLimit: string;
  readScreenshots: boolean;
  writingHelp: boolean;
};

function formOf(s: AiSettingsDTO): Form {
  return {
    enabled: s.enabled,
    // Only the model saved here is editable; one from AI_MODEL shows as a hint.
    model: s.modelSource === 'SETTINGS' ? (s.model ?? '') : '',
    monthlyLimit: String(s.monthlyLimit),
    readScreenshots: s.readScreenshots,
    writingHelp: s.writingHelp,
  };
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/**
 * Admin page for AI assistance: off by default; on only with a Claude API key
 * and a model. The key is write-only — the page shows its last four
 * characters, never the key.
 */
export function AiSettings({
  initial,
  status,
}: {
  initial: AiSettingsDTO | null;
  status: AiStatusDTO;
}) {
  const t = useTranslations('settings.ai');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(initial);
  const [form, setForm] = React.useState<Form | null>(initial ? formOf(initial) : null);
  const [apiKey, setApiKey] = React.useState('');

  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.ai.updateSettings>[0]) => api.ai.updateSettings(body),
    onSuccess: (res) => {
      setSaved(res);
      setForm(formOf(res));
      setApiKey('');
      toast.success(t('savedToast'));
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  if (!saved || !form) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm">{status.available ? t('statusOn') : t('statusOff')}</p>
          <p className="text-muted-foreground text-xs">{t('adminOnly')}</p>
        </CardContent>
      </Card>
    );
  }

  const limit = Number(form.monthlyLimit);
  const limitInvalid = !/^\d+$/.test(form.monthlyLimit.trim()) || limit > 100_000;
  const base = formOf(saved);
  const dirty =
    apiKey.trim() !== '' ||
    form.enabled !== base.enabled ||
    form.model.trim() !== base.model ||
    form.monthlyLimit.trim() !== base.monthlyLimit ||
    form.readScreenshots !== base.readScreenshots ||
    form.writingHelp !== base.writingHelp;

  function save() {
    if (!form || !saved) return;
    update.mutate({
      ...(form.enabled !== base.enabled ? { enabled: form.enabled } : {}),
      ...(form.model.trim() !== base.model ? { model: form.model.trim() || null } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(form.monthlyLimit.trim() !== base.monthlyLimit ? { monthlyLimit: limit } : {}),
      ...(form.readScreenshots !== base.readScreenshots
        ? { readScreenshots: form.readScreenshots }
        : {}),
      ...(form.writingHelp !== base.writingHelp ? { writingHelp: form.writingHelp } : {}),
    });
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const keyLine =
    saved.apiKey.source === 'SETTINGS'
      ? t('key.saved', { last4: saved.apiKey.last4 ?? '' })
      : saved.apiKey.source === 'ENV'
        ? t('key.fromEnv', { last4: saved.apiKey.last4 ?? '' })
        : t('key.none');
  const usedPct =
    saved.monthlyLimit > 0
      ? Math.min(100, Math.round((saved.usage.used / saved.monthlyLimit) * 100))
      : 100;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t('switch.title')}
            <Badge tone={saved.available ? 'success' : 'neutral'}>
              {saved.available
                ? t('switch.on')
                : saved.enabled
                  ? t('switch.incomplete')
                  : t('switch.off')}
            </Badge>
          </CardTitle>
          <p className="text-muted-foreground text-sm">{t('switch.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            id="ai-enabled"
            label={t('switch.label')}
            hint={t('switch.hint')}
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            disabled={update.isPending}
          />
          <ToggleRow
            id="ai-read-screenshots"
            label={t('features.readScreenshots')}
            hint={t('features.readScreenshotsHint')}
            checked={form.readScreenshots}
            onChange={(v) => set('readScreenshots', v)}
            disabled={update.isPending}
          />
          <ToggleRow
            id="ai-writing-help"
            label={t('features.writingHelp')}
            hint={t('features.writingHelpHint')}
            checked={form.writingHelp}
            onChange={(v) => set('writingHelp', v)}
            disabled={update.isPending}
          />
          <p className="text-muted-foreground bg-surface-muted rounded-lg p-3 text-xs">
            {t('privacy')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {t('connection.title')}
          </CardTitle>
          <p className="text-muted-foreground text-sm">{t('connection.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t('key.label')} hint={keyLine}>
            <Input
              type="password"
              aria-label={t('key.label')}
              dir="ltr"
              autoComplete="off"
              value={apiKey}
              placeholder={
                saved.apiKey.source === 'NONE' ? 'sk-ant-…' : t('key.replacePlaceholder')
              }
              onChange={(e) => setApiKey(e.target.value)}
              disabled={update.isPending}
            />
          </Field>
          {saved.apiKey.source === 'SETTINGS' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ apiKey: null })}
            >
              {t('key.remove')}
            </Button>
          ) : null}
          <Field
            label={t('model.label')}
            hint={
              saved.modelSource === 'ENV' && !form.model.trim()
                ? t('model.fromEnv', { model: saved.model ?? '' })
                : t('model.hint')
            }
          >
            <Input
              aria-label={t('model.label')}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={form.model}
              placeholder={t('model.placeholder')}
              onChange={(e) => set('model', e.target.value)}
              disabled={update.isPending}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" /> {t('usage.title')}
          </CardTitle>
          <p className="text-muted-foreground text-sm">{t('usage.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label={t('usage.limit')}
            error={limitInvalid ? t('usage.limitInvalid') : undefined}
            hint={t('usage.limitHint')}
          >
            <Input
              aria-label={t('usage.limit')}
              inputMode="numeric"
              dir="ltr"
              className="max-w-[10rem]"
              value={form.monthlyLimit}
              onChange={(e) => set('monthlyLimit', e.target.value)}
              disabled={update.isPending}
            />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm">
              {t.rich('usage.used', {
                used: saved.usage.used,
                limit: saved.monthlyLimit,
                n: (chunks) => <LtrText className="font-semibold">{chunks}</LtrText>,
              })}
            </p>
            <div className="bg-surface-muted h-2 overflow-hidden rounded-full" aria-hidden>
              <div
                className={`h-full rounded-full ${usedPct >= 90 ? 'bg-danger' : 'bg-brand'}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            {saved.usage.byFeature.length ? (
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                {saved.usage.byFeature.map((f) => (
                  <li key={f.feature} className="flex justify-between gap-2">
                    <span>{t(`usage.features.${f.feature}`)}</span>
                    <LtrText>{f.count}</LtrText>
                  </li>
                ))}
              </ul>
            ) : null}
            {saved.usage.failed ? (
              <p className="text-muted-foreground text-xs">
                {t('usage.failed', { count: saved.usage.failed })}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!dirty || update.isPending}
          onClick={() => {
            setForm(formOf(saved));
            setApiKey('');
          }}
        >
          {tCommon('cancel')}
        </Button>
        <Button disabled={!dirty || limitInvalid || update.isPending} onClick={save}>
          {update.isPending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
