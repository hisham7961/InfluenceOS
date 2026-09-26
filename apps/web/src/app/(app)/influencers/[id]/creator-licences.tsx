'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeCheck, FileText, Pencil, Plus, ShieldAlert, Trash2, Upload, X } from 'lucide-react';
import type { CreatorLicenceDTO } from '@influenceos/contracts';
import { addBusinessDays, businessDateKey, startOfBusinessDay } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { toBrowserUrl, uploadAttachment } from '@/lib/upload';
import { GULF_COUNTRY_CODES, useCountryName, useSortedCountries } from '@/lib/country-names';
import { useLocalizedFormat } from '@/lib/format';
import { useApp } from '@/components/shell/app-context';
import { LtrText } from '@/components/common/bidi-text';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A date field's value → the start of that day in Kuwait. */
const dayStart = (v: string) => (v ? startOfBusinessDay(v) : null);
/** A date field's value → the last moment of that day in Kuwait (a licence is good through its end date). */
const dayEnd = (v: string) =>
  v ? new Date(startOfBusinessDay(addBusinessDays(v, 1)).getTime() - 1) : null;
const toField = (iso: string | null) => (iso ? businessDateKey(iso) : '');

/**
 * A creator's advertising licences (P3.5), one per country: number, who
 * issued it, dates and the scanned licence. Campaigns aimed at a country
 * that needs one check their roster against these.
 */
export function CreatorLicences({
  influencerId,
  influencerName,
}: {
  influencerId: string;
  influencerName: string;
}) {
  const t = useTranslations('influencers');
  const tCommon = useTranslations('common');
  const { can } = useApp();
  const canManage = can('INFLUENCERS_MANAGE');
  const queryClient = useQueryClient();
  const name = useCountryName();
  const { shortDate } = useLocalizedFormat();
  const [editing, setEditing] = React.useState<CreatorLicenceDTO | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<CreatorLicenceDTO | null>(null);

  const query = useQuery({
    queryKey: qk.influencer.licences(influencerId),
    queryFn: () => api.licences.forInfluencer(influencerId),
  });
  const licences = query.data ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api.licences.remove(id),
    onSuccess: () => {
      toast.success(t('licences.removedToast'));
      queryClient.invalidateQueries({ queryKey: qk.influencer.licences(influencerId) });
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
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
    <Card className="h-fit" id="licences">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t('licences.title')}</CardTitle>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> {t('licences.add')}
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{t('licences.description')}</p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>
        ) : licences.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('licences.empty')}</p>
        ) : (
          <ul className="divide-border divide-y">
            {licences.map((l) => (
              <li
                key={l.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{name(l.countryCode)}</span>
                    <LicenceStatusBadge licence={l} />
                  </div>
                  {l.authority || l.number ? (
                    <p className="text-muted-foreground text-xs">
                      {l.authority}
                      {l.authority && l.number ? ' · ' : null}
                      {l.number ? <LtrText>{l.number}</LtrText> : null}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {l.expiresAt
                      ? t('licences.validUntil', { date: shortDate(l.expiresAt) })
                      : t('licences.noExpiry')}
                  </p>
                  {l.document ? (
                    <button
                      type="button"
                      onClick={() => openDocument(l.document!.id)}
                      className="bg-surface-muted text-foreground/80 hover:bg-surface-muted/70 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-xs"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{l.document.fileName}</span>
                    </button>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('licences.edit')}
                      onClick={() => setEditing(l)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('licences.remove')}
                      onClick={() => setRemoving(l)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <LicenceDialog
        influencerId={influencerId}
        influencerName={influencerName}
        licence={editing === 'new' ? null : editing}
        taken={licences.map((l) => l.countryCode)}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('licences.removeTitle')}
        description={
          removing
            ? t('licences.removeDescription', { country: name(removing.countryCode) })
            : undefined
        }
        confirmLabel={t('licences.remove')}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

function LicenceStatusBadge({ licence }: { licence: CreatorLicenceDTO }) {
  const t = useTranslations('influencers');
  if (licence.status === 'EXPIRED') {
    return (
      <Badge tone="danger" className="gap-1">
        <ShieldAlert className="h-3 w-3" /> {t('licences.expired')}
      </Badge>
    );
  }
  if (licence.status === 'EXPIRING_SOON') {
    return (
      <Badge tone="warning" className="gap-1">
        <ShieldAlert className="h-3 w-3" />{' '}
        {t('licences.expiresInDays', { count: licence.daysLeft ?? 0 })}
      </Badge>
    );
  }
  return (
    <Badge tone="success" className="gap-1">
      <BadgeCheck className="h-3 w-3" /> {t('licences.valid')}
    </Badge>
  );
}

function LicenceDialog({
  influencerId,
  influencerName,
  licence,
  taken,
  open,
  onOpenChange,
}: {
  influencerId: string;
  influencerName: string;
  licence: CreatorLicenceDTO | null;
  taken: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('influencers');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const name = useCountryName();
  const all = useSortedCountries();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [country, setCountry] = React.useState('');
  const [authority, setAuthority] = React.useState('');
  const [number, setNumber] = React.useState('');
  const [issued, setIssued] = React.useState('');
  const [expires, setExpires] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [doc, setDoc] = React.useState<{ id: string; fileName: string } | null>(null);
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const free = GULF_COUNTRY_CODES.find((c) => !taken.includes(c)) ?? '';
    setCountry(licence?.countryCode ?? free);
    setAuthority(licence?.authority ?? '');
    setNumber(licence?.number ?? '');
    setIssued(toField(licence?.issuedAt ?? null));
    setExpires(toField(licence?.expiresAt ?? null));
    setNotes(licence?.notes ?? '');
    setDoc(
      licence?.document ? { id: licence.document.id, fileName: licence.document.fileName } : null,
    );
    // `taken` changes identity each render; the dialog resets when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, licence]);

  const available = (code: string) => code === licence?.countryCode || !taken.includes(code);
  const gulf = GULF_COUNTRY_CODES.filter(available);
  const others = all.filter(
    (c) => !(GULF_COUNTRY_CODES as readonly string[]).includes(c.code) && available(c.code),
  );

  async function pickFile(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(file, { influencerId });
      setDoc({ id: uploaded.id, fileName: uploaded.fileName });
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
    } catch (e) {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const save = useMutation({
    mutationFn: () => {
      if (issued && expires && expires < issued) throw new Error(t('licences.datesError'));
      const body = {
        countryCode: country,
        authority: authority.trim() || null,
        number: number.trim() || null,
        issuedAt: dayStart(issued),
        expiresAt: dayEnd(expires),
        attachmentId: doc?.id ?? null,
        notes: notes.trim() || null,
      };
      return licence
        ? api.licences.update(licence.id, body)
        : api.licences.create(influencerId, body);
    },
    onSuccess: () => {
      toast.success(licence ? t('licences.updatedToast') : t('licences.addedToast'));
      queryClient.invalidateQueries({ queryKey: qk.influencer.licences(influencerId) });
      // Rosters and Needs Attention read the same licences.
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{licence ? t('licences.editTitle') : t('licences.addTitle')}</DialogTitle>
          <DialogDescription>
            {t('licences.dialogDescription', { name: influencerName })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('licences.fields.country')} className="sm:col-span-2">
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger aria-label={t('licences.fields.country')}>
                <SelectValue placeholder={t('licences.fields.countryPlaceholder')} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {gulf.map((code) => (
                  <SelectItem key={code} value={code}>
                    {name(code)}
                  </SelectItem>
                ))}
                {gulf.length && others.length ? <SelectSeparator /> : null}
                {others.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('licences.fields.authority')} hint={t('licences.optional')}>
            <Input
              value={authority}
              aria-label={t('licences.fields.authority')}
              onChange={(e) => setAuthority(e.target.value)}
              placeholder={t('licences.fields.authorityPlaceholder')}
              maxLength={120}
            />
          </Field>
          <Field label={t('licences.fields.number')} hint={t('licences.optional')}>
            <Input
              value={number}
              aria-label={t('licences.fields.number')}
              onChange={(e) => setNumber(e.target.value)}
              dir="ltr"
              maxLength={80}
            />
          </Field>
          <Field label={t('licences.fields.issuedAt')} hint={t('licences.optional')}>
            <Input
              type="date"
              value={issued}
              aria-label={t('licences.fields.issuedAt')}
              onChange={(e) => setIssued(e.target.value)}
            />
          </Field>
          <Field label={t('licences.fields.expiresAt')} hint={t('licences.fields.expiresAtHint')}>
            <Input
              type="date"
              value={expires}
              aria-label={t('licences.fields.expiresAt')}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
          <Field label={t('licences.fields.document')} className="sm:col-span-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
            />
            {doc ? (
              <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('licences.fields.removeDocument')}
                  onClick={() => setDoc(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
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
                {uploading ? t('licences.fields.uploading') : t('licences.fields.upload')}
              </Button>
            )}
          </Field>
          <Field
            label={t('licences.fields.notes')}
            hint={t('licences.optional')}
            className="sm:col-span-2"
          >
            <Textarea
              value={notes}
              aria-label={t('licences.fields.notes')}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!country || save.isPending || uploading}>
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
