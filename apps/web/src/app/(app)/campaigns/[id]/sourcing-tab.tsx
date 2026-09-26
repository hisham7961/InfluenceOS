'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, MoreHorizontal, Pencil, Plus, RotateCcw, Star, Trash2, UserCheck, UserPlus, UserSearch, X } from 'lucide-react';
import type { CampaignCandidateDTO, CandidateStatus, DealType } from '@influenceos/contracts';
import { CANDIDATE_STATUSES, CANDIDATE_STATUS_TONE, DEAL_TYPES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { useLocalizedFormat } from '@/lib/format';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { EntityCombobox } from '@/components/common/entity-combobox';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { ImportCandidatesDialog } from './import-candidates-dialog';
import { errorMessage } from '@/lib/errors';

type Decision = 'SHORTLIST' | 'APPROVE' | 'REJECT' | 'RECONSIDER';


function parseMoney(value: string): number | null {
  const n = Number(value.replace(/,/g, '').trim());
  return value.trim() && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Sourcing pipeline for a campaign: creators being considered before anyone
 * commits to them. Add a creator (or import a CSV), shortlist, approve or
 * reject with a reason, and move an approved or shortlisted creator onto the
 * roster with their deal terms — none of it touches the creator's
 * collaboration history until they're on the roster.
 */
export function SourcingTab({ campaignId, currency }: { campaignId: string; currency: string }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const [filter, setFilter] = React.useState<CandidateStatus | 'ALL'>('ALL');
  const [addOpen, setAddOpen] = React.useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-candidates', campaignId],
    queryFn: () => api.campaigns.candidates(campaignId),
  });

  const candidates = data ?? [];
  const counts = CANDIDATE_STATUSES.map((s) => ({ status: s, count: candidates.filter((c) => c.status === s).length })).filter(
    (c) => c.count > 0,
  );
  const visible = filter === 'ALL' ? candidates : candidates.filter((c) => c.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('sourcing.title')}</h3>
          <p className="text-xs text-muted-foreground">
            {candidates.length > 0 ? t('sourcing.candidateCount', { count: candidates.length }) : t('sourcing.subtitleEmpty')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportCandidatesDialog campaignId={campaignId} />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> {t('sourcing.addCandidate')}
          </Button>
        </div>
      </div>

      {counts.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Button variant={filter === 'ALL' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter('ALL')}>
            {t('operations.chipWithCount', { label: t('operations.allChip'), count: candidates.length })}
          </Button>
          {counts.map((c) => (
            <Button
              key={c.status}
              variant={filter === c.status ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(filter === c.status ? 'ALL' : c.status)}
            >
              {t('operations.chipWithCount', { label: enumLabel(tEnums, 'candidateStatus', c.status), count: c.count })}
            </Button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState icon={UserSearch} title={t('sourcing.loadErrorTitle')} description={t('sourcing.loadErrorDescription')} />
      ) : candidates.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title={t('sourcing.emptyTitle')}
          description={t('sourcing.emptyDescription')}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> {t('sourcing.addCandidate')}
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <Table className="min-w-[860px]">
              <TableHead>
                <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableHeaderCell className="ps-5">{t('sourcing.creatorHeader')}</TableHeaderCell>
                  <TableHeaderCell align="end">{t('sourcing.fitHeader')}</TableHeaderCell>
                  <TableHeaderCell>{t('fields.notes')}</TableHeaderCell>
                  <TableHeaderCell>{t('sourcing.decisionHeader')}</TableHeaderCell>
                  <TableHeaderCell>{t('fields.status')}</TableHeaderCell>
                  <TableHeaderCell align="end">
                    <span className="sr-only">{t('sourcing.actionsHeader')}</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((cand) => (
                  <CandidateRow key={cand.id} candidate={cand} campaignId={campaignId} currency={currency} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Card>
      )}

      <AddCandidateDialog
        campaignId={campaignId}
        open={addOpen}
        onOpenChange={setAddOpen}
        existing={new Set(candidates.map((c) => c.influencer.id))}
      />
    </div>
  );
}

function CandidateRow({
  candidate: cand,
  campaignId,
  currency,
}: {
  candidate: CampaignCandidateDTO;
  campaignId: string;
  currency: string;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const { relativeTime } = useLocalizedFormat();
  const [editOpen, setEditOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [convertOpen, setConvertOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['campaign-candidates', campaignId] });

  const decide = useMutation({
    mutationFn: (input: { decision: Decision; reason?: string }) => api.candidates.decide(cand.id, input),
    onSuccess: (row) => {
      toast.success(
        t('sourcing.decidedToast', {
          name: cand.influencer.displayName,
          status: enumLabel(tEnums, 'candidateStatus', row.status),
        }),
      );
      setRejectOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const remove = useMutation({
    mutationFn: () => api.candidates.remove(cand.id),
    onSuccess: () => {
      toast.success(t('sourcing.removedToast', { name: cand.influencer.displayName }));
      setRemoveOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const converted = cand.status === 'CONVERTED';
  const canConvert = cand.status === 'APPROVED' || cand.status === 'SHORTLISTED';
  const busy = decide.isPending;

  // The one next step for this row, as a visible button; everything else lives in the menu.
  const primary = canConvert ? (
    <Button size="sm" onClick={() => setConvertOpen(true)}>
      <UserPlus className="h-3.5 w-3.5" /> {t('sourcing.convert')}
    </Button>
  ) : cand.status === 'CONSIDERING' ? (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => decide.mutate({ decision: 'SHORTLIST' })}>
      <Star className="h-3.5 w-3.5" /> {t('sourcing.shortlist')}
    </Button>
  ) : cand.status === 'REJECTED' ? (
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide.mutate({ decision: 'RECONSIDER' })}>
      <RotateCcw className="h-3.5 w-3.5" /> {t('sourcing.reconsider')}
    </Button>
  ) : null;

  return (
    <TableRow>
      <TableCell className="ps-5">
        <Link href={`/influencers/${cand.influencer.id}`} className="flex items-center gap-2.5 hover:underline">
          <Avatar name={cand.influencer.displayName} src={cand.influencer.avatarUrl ?? undefined} size="xs" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              <BidiText>{cand.influencer.displayName}</BidiText>
            </p>
            {cand.influencer.primaryUsername ? (
              <p className="truncate text-xs text-muted-foreground">
                <LtrText>@{cand.influencer.primaryUsername}</LtrText>
              </p>
            ) : null}
          </div>
        </Link>
      </TableCell>
      <TableCell align="end">{cand.fitScore == null ? '—' : cand.fitScore}</TableCell>
      <TableCell className="max-w-[220px] truncate whitespace-normal text-muted-foreground">
        <span className="line-clamp-2">{cand.notes ?? '—'}</span>
      </TableCell>
      <TableCell className="max-w-[220px] whitespace-normal text-muted-foreground">
        {cand.decisionReason ? <span className="line-clamp-2">{cand.decisionReason}</span> : null}
        {cand.decidedByName && cand.decidedAt ? (
          <span className="block text-xs">
            {t('sourcing.decidedBy', { name: cand.decidedByName, when: relativeTime(cand.decidedAt) })}
          </span>
        ) : cand.decisionReason ? null : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <Badge tone={CANDIDATE_STATUS_TONE[cand.status]}>{enumLabel(tEnums, 'candidateStatus', cand.status)}</Badge>
      </TableCell>
      <TableCell align="end">
        <div className="flex items-center justify-end gap-1">
          {primary}
          {converted ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('sourcing.moreActions', { name: cand.influencer.displayName })}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {cand.status !== 'SHORTLISTED' && cand.status !== 'REJECTED' ? (
                  <DropdownMenuItem onSelect={() => decide.mutate({ decision: 'SHORTLIST' })}>
                    <Star className="h-4 w-4" /> {t('sourcing.shortlist')}
                  </DropdownMenuItem>
                ) : null}
                {cand.status !== 'APPROVED' ? (
                  <DropdownMenuItem onSelect={() => decide.mutate({ decision: 'APPROVE' })}>
                    <Check className="h-4 w-4" /> {t('sourcing.approve')}
                  </DropdownMenuItem>
                ) : null}
                {cand.status !== 'REJECTED' ? (
                  <DropdownMenuItem onSelect={() => setRejectOpen(true)}>
                    <X className="h-4 w-4" /> {t('sourcing.reject')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => decide.mutate({ decision: 'RECONSIDER' })}>
                    <RotateCcw className="h-4 w-4" /> {t('sourcing.reconsider')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" /> {t('sourcing.editNotes')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRemoveOpen(true)} className="text-danger">
                  <Trash2 className="h-4 w-4" /> {t('sourcing.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {converted ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <UserCheck className="h-3.5 w-3.5" /> {t('sourcing.onRoster')}
            </span>
          ) : null}
        </div>

        <EditCandidateDialog candidate={cand} open={editOpen} onOpenChange={setEditOpen} onSaved={invalidate} />
        <RejectDialog
          name={cand.influencer.displayName}
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          loading={decide.isPending}
          onReject={(reason) => decide.mutate({ decision: 'REJECT', reason: reason || undefined })}
        />
        <ConvertCandidateDialog
          candidate={cand}
          currency={currency}
          open={convertOpen}
          onOpenChange={setConvertOpen}
          onConverted={invalidate}
        />
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={t('sourcing.removeTitle')}
          description={t('sourcing.removeDescription', { name: cand.influencer.displayName })}
          confirmLabel={t('sourcing.remove')}
          loading={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </TableCell>
    </TableRow>
  );
}

function AddCandidateDialog({
  campaignId,
  open,
  onOpenChange,
  existing,
}: {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Set<string>;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [influencerId, setInfluencerId] = React.useState('');
  const [fit, setFit] = React.useState('');
  const [notes, setNotes] = React.useState('');

  function reset() {
    setInfluencerId('');
    setFit('');
    setNotes('');
  }

  const fitScore = fit.trim() ? Number(fit) : null;
  const fitInvalid = fitScore != null && (!Number.isInteger(fitScore) || fitScore < 0 || fitScore > 100);
  const already = influencerId !== '' && existing.has(influencerId);

  const add = useMutation({
    mutationFn: () =>
      api.campaigns.addCandidate(campaignId, { influencerId, fitScore, notes: notes.trim() || undefined }),
    onSuccess: (row) => {
      toast.success(t('sourcing.addedToast', { name: row.influencer.displayName }));
      queryClient.invalidateQueries({ queryKey: ['campaign-candidates', campaignId] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sourcing.addTitle')}</DialogTitle>
          <DialogDescription>{t('sourcing.addDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('sourcing.creatorHeader')}>
            <EntityCombobox
              kind="influencer"
              value={influencerId}
              onChange={(id) => setInfluencerId(id)}
              placeholder={t('sourcing.pickCreator')}
              aria-label={t('sourcing.creatorHeader')}
            />
          </Field>
          {already ? <p className="text-sm text-warning">{t('sourcing.alreadyCandidate')}</p> : null}
          <Field label={t('sourcing.fitLabel')} hint={t('sourcing.fitHint')} error={fitInvalid ? t('sourcing.fitInvalid') : undefined}>
            <Input inputMode="numeric" value={fit} onChange={(e) => setFit(e.target.value)} placeholder="0–100" />
          </Field>
          <Field label={t('fields.notes')}>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('sourcing.notesPlaceholder')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!influencerId || fitInvalid || already || add.isPending} onClick={() => add.mutate()}>
            {t('sourcing.addCandidate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCandidateDialog({
  candidate,
  open,
  onOpenChange,
  onSaved,
}: {
  candidate: CampaignCandidateDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const [fit, setFit] = React.useState(candidate.fitScore == null ? '' : String(candidate.fitScore));
  const [notes, setNotes] = React.useState(candidate.notes ?? '');
  React.useEffect(() => {
    if (open) {
      setFit(candidate.fitScore == null ? '' : String(candidate.fitScore));
      setNotes(candidate.notes ?? '');
    }
  }, [open, candidate.fitScore, candidate.notes]);

  const fitScore = fit.trim() ? Number(fit) : null;
  const fitInvalid = fitScore != null && (!Number.isInteger(fitScore) || fitScore < 0 || fitScore > 100);
  const save = useMutation({
    mutationFn: () => api.candidates.update(candidate.id, { fitScore, notes: notes.trim() || null }),
    onSuccess: () => {
      toast.success(t('sourcing.savedToast'));
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sourcing.editTitle', { name: candidate.influencer.displayName })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('sourcing.fitLabel')} hint={t('sourcing.fitHint')} error={fitInvalid ? t('sourcing.fitInvalid') : undefined}>
            <Input inputMode="numeric" value={fit} onChange={(e) => setFit(e.target.value)} placeholder="0–100" />
          </Field>
          <Field label={t('fields.notes')}>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={fitInvalid || save.isPending} onClick={() => save.mutate()}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  name,
  open,
  onOpenChange,
  loading,
  onReject,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  onReject: (reason: string) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sourcing.rejectTitle', { name })}</DialogTitle>
          <DialogDescription>{t('sourcing.rejectDescription')}</DialogDescription>
        </DialogHeader>
        <Field label={t('sourcing.reasonLabel')}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('sourcing.reasonPlaceholder')} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button variant="danger" disabled={loading} onClick={() => onReject(reason.trim())}>
            {t('sourcing.reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move an approved or shortlisted creator onto the roster with their deal terms. */
function ConvertCandidateDialog({
  candidate,
  currency,
  open,
  onOpenChange,
  onConverted,
}: {
  candidate: CampaignCandidateDTO;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted: () => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dealType, setDealType] = React.useState<DealType>('PAID');
  const [fee, setFee] = React.useState('');
  const [gift, setGift] = React.useState('');
  const [publishOn, setPublishOn] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setDealType('PAID');
      setFee('');
      setGift('');
      setPublishOn('');
    }
  }, [open]);

  const paid = dealType === 'PAID' || dealType === 'PAID_PLUS_GIFTED';
  const gifted = dealType === 'GIFTED_PRODUCT' || dealType === 'PAID_PLUS_GIFTED';
  const feeValue = parseMoney(fee);
  const giftValue = parseMoney(gift);
  const feeInvalid = paid && fee.trim() !== '' && feeValue == null;
  const giftInvalid = gifted && gift.trim() !== '' && giftValue == null;

  const convert = useMutation({
    mutationFn: () =>
      api.candidates.convert(candidate.id, {
        dealType,
        agreedCost: paid ? feeValue : null,
        currency,
        giftedProductValue: gifted ? giftValue : null,
        expectedPublishAt: publishOn ? new Date(`${publishOn}T12:00:00`) : null,
      }),
    onSuccess: () => {
      toast.success(t('sourcing.convertedToast', { name: candidate.influencer.displayName }));
      onConverted();
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sourcing.convertTitle', { name: candidate.influencer.displayName })}</DialogTitle>
          <DialogDescription>{t('sourcing.convertDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.dealType')} className="sm:col-span-2">
            <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_TYPES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {enumLabel(tEnums, 'dealType', d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {paid ? (
            <Field
              label={t('sourcing.feeLabel', { currency })}
              error={feeInvalid ? t('workspace.influencers.invalidAgreedCost') : undefined}
            >
              <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.000" />
            </Field>
          ) : null}
          {gifted ? (
            <Field
              label={t('sourcing.giftLabel', { currency })}
              error={giftInvalid ? t('workspace.influencers.invalidGiftValue') : undefined}
            >
              <Input inputMode="decimal" value={gift} onChange={(e) => setGift(e.target.value)} placeholder="0.000" />
            </Field>
          ) : null}
          <Field label={t('sourcing.expectedPublishLabel')} hint={t('fields.optionalHint')}>
            <Input type="date" value={publishOn} onChange={(e) => setPublishOn(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={feeInvalid || giftInvalid || convert.isPending} onClick={() => convert.mutate()}>
            <UserPlus className="h-4 w-4" /> {t('sourcing.convert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
