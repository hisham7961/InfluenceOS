'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Pencil } from 'lucide-react';
import type { BrandDetailDTO } from '@influenceos/contracts';
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
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/errors';


/** Editable brand identity — a swatch + hex input, with a toggle for the optional colors. */
function ColorField({
  label,
  value,
  onChange,
  toggleLabel,
  notSetLabel,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Aria-label for the enable/disable switch — omit for the always-on primary color, which has no switch. */
  toggleLabel?: string;
  notSetLabel: string;
}) {
  const enabled = value !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {toggleLabel ? (
          <Switch
            aria-label={toggleLabel}
            checked={enabled}
            onCheckedChange={(on) => onChange(on ? '#6366F1' : null)}
          />
        ) : null}
      </div>
      {enabled ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-border bg-surface"
          />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#6366F1"
            className="font-mono"
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{notSetLabel}</p>
      )}
    </div>
  );
}

/** "Edit brand" trigger + dialog for the brand workspace. Patches name, description, identity colors and status. */
export function BrandEditDialog({ brand }: { brand: BrandDetailDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('brands');
  const tc = useTranslations('common');

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(brand.name);
  const [description, setDescription] = React.useState(brand.description ?? '');
  const [primaryColor, setPrimaryColor] = React.useState(brand.primaryColor);
  const [secondaryColor, setSecondaryColor] = React.useState<string | null>(brand.secondaryColor);
  const [accentColor, setAccentColor] = React.useState<string | null>(brand.accentColor);
  const [logoUrl, setLogoUrl] = React.useState(brand.logoUrl ?? '');
  const [coverUrl, setCoverUrl] = React.useState(brand.coverUrl ?? '');
  const [isActive, setIsActive] = React.useState(brand.isActive);

  // Re-seed the form whenever the underlying brand changes (e.g. after a refresh).
  React.useEffect(() => {
    if (open) return;
    setName(brand.name);
    setDescription(brand.description ?? '');
    setPrimaryColor(brand.primaryColor);
    setSecondaryColor(brand.secondaryColor);
    setAccentColor(brand.accentColor);
    setLogoUrl(brand.logoUrl ?? '');
    setCoverUrl(brand.coverUrl ?? '');
    setIsActive(brand.isActive);
  }, [brand, open]);

  const update = useMutation({
    mutationFn: () =>
      api.brands.update(brand.id, {
        name: name.trim(),
        description: description.trim() || null,
        primaryColor,
        secondaryColor,
        accentColor,
        logoUrl: logoUrl.trim() || null,
        coverUrl: coverUrl.trim() || null,
        isActive,
      }),
    onSuccess: (updated) => {
      toast.success(t('edit.updated', { name: updated.name }));
      queryClient.invalidateQueries();
      router.refresh();
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 border-white/30 bg-white/15 text-white backdrop-blur hover:bg-white/25"
        >
          <Pencil className="h-4 w-4" /> {t('edit.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
          <DialogDescription>{t('edit.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label={t('edit.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('edit.namePlaceholder')} />
          </Field>

          <Field label={t('edit.description')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('edit.descriptionPlaceholder')}
              rows={3}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField
              label={t('edit.primaryColor')}
              value={primaryColor}
              onChange={(v) => setPrimaryColor(v ?? primaryColor)}
              notSetLabel={t('edit.colorNotSet')}
            />
            <ColorField
              label={t('edit.secondaryColor')}
              value={secondaryColor}
              onChange={setSecondaryColor}
              toggleLabel={t('edit.useSecondaryColor')}
              notSetLabel={t('edit.colorNotSet')}
            />
            <ColorField
              label={t('edit.accentColor')}
              value={accentColor}
              onChange={setAccentColor}
              toggleLabel={t('edit.useAccentColor')}
              notSetLabel={t('edit.colorNotSet')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('edit.logoUrl')} hint={t('edit.optional')}>
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder={t('edit.urlPlaceholder')} />
            </Field>
            <Field label={t('edit.coverUrl')} hint={t('edit.optional')}>
              <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder={t('edit.urlPlaceholder')} />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5">
            <div>
              <Label>{t('status.active')}</Label>
              <p className="text-xs text-muted-foreground">{t('edit.activeHint')}</p>
            </div>
            <Switch aria-label={t('status.active')} checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={update.isPending}>
            {tc('cancel')}
          </Button>
          <Button disabled={!name.trim() || update.isPending} onClick={() => update.mutate()}>
            {update.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {update.isPending ? tc('saving') : t('edit.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
