'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, MessageCircle } from 'lucide-react';
import {
  creatorMessageLanguage,
  renderWhatsAppTemplate,
  whatsappLink,
  whatsappNumber,
  type ContactPurpose,
  type WhatsAppLanguage,
  type WhatsAppTemplateContext,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { LtrText } from '@/components/common/bidi-text';

interface Recipient {
  key: string;
  label: string;
  number: string;
}

export interface WhatsAppDialogProps {
  influencerId: string;
  creatorName: string;
  purpose: ContactPurpose;
  /** What the template can mention: campaign, brand, deliverables, fee, tracking… */
  context?: Omit<WhatsAppTemplateContext, 'creatorName'>;
  /** Roster row the message is about — marks it contacted when first used. */
  campaignInfluencerId?: string;
  variant?: 'ghost' | 'secondary' | 'outline';
  /** Just the icon (with an accessible label), for tight action rows. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Message a creator on WhatsApp from a ready template: pick who to send to
 * (the creator's WhatsApp or mobile, or their manager), the language, edit
 * the text, and open WhatsApp with it. Opening it logs the contact on the
 * creator's timeline (and marks the roster row contacted).
 */
export function WhatsAppDialog({
  influencerId,
  creatorName,
  purpose,
  context,
  campaignInfluencerId,
  variant = 'ghost',
  iconOnly = false,
  className,
}: WhatsAppDialogProps) {
  const t = useTranslations('influencers');
  const locale = useLocale();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  // Chosen language, else the creator's own (from their profile), else the app's.
  const [chosenLang, setLang] = React.useState<WhatsAppLanguage | null>(null);
  const [recipientKey, setRecipientKey] = React.useState<string | null>(null);
  const [text, setText] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  const detail = useQuery({
    queryKey: ['influencer-contact', influencerId],
    queryFn: () => api.influencers.get(influencerId),
    enabled: open,
    staleTime: 60_000,
  });

  const recipients = React.useMemo<Recipient[]>(() => {
    const c = detail.data?.contact;
    if (!c) return [];
    const out: Recipient[] = [];
    const seen = new Set<string>();
    const push = (key: string, label: string, raw: string | null) => {
      const number = whatsappNumber(raw);
      if (!number || seen.has(number)) return;
      seen.add(number);
      out.push({ key, label, number });
    };
    push('whatsapp', t('whatsapp.recipient.whatsapp'), c.whatsapp);
    push('mobile', t('whatsapp.recipient.mobile'), c.mobile);
    push(
      'manager',
      c.managerName ? t('whatsapp.recipient.managerNamed', { name: c.managerName }) : t('whatsapp.recipient.manager'),
      c.managerContact,
    );
    return out;
  }, [detail.data, t]);

  const lang: WhatsAppLanguage = chosenLang ?? creatorMessageLanguage(detail.data?.languages) ?? (locale === 'en' ? 'en' : 'ar');

  const recipient = recipients.find((r) => r.key === recipientKey) ?? recipients[0] ?? null;

  // A fresh draft whenever the dialog opens or the language changes.
  React.useEffect(() => {
    if (open) setText(renderWhatsAppTemplate(purpose, lang, { creatorName, ...context }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context is a fresh object each render; the draft only resets on open/language.
  }, [open, lang, purpose, creatorName]);

  const log = useMutation({
    mutationFn: () => api.influencers.logContact(influencerId, { channel: 'WHATSAPP', purpose, campaignInfluencerId }),
    onSuccess: () => {
      toast.success(t('whatsapp.loggedToast'));
      qc.invalidateQueries({
        predicate: (q) => {
          const root = String(q.queryKey[0] ?? '');
          return root.startsWith('creator') || root.startsWith('influencer') || root.startsWith('campaign');
        },
      });
    },
    // The message itself already opened in WhatsApp; a failed log is only worth a note.
    onError: () => toast.error(t('whatsapp.logFailedToast')),
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is still selectable */
    }
  }

  const label = t(`whatsapp.purpose.${purpose}`);

  return (
    <>
      {iconOnly ? (
        <Button
          type="button"
          variant={variant}
          size="icon-sm"
          className={className}
          aria-label={t('whatsapp.ariaLabel', { action: label, name: creatorName })}
          title={t('whatsapp.ariaLabel', { action: label, name: creatorName })}
          onClick={() => setOpen(true)}
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" variant={variant} size="sm" className={className} onClick={() => setOpen(true)}>
          <MessageCircle className="h-3.5 w-3.5" /> {label}
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setLang(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('whatsapp.title', { name: creatorName })}</DialogTitle>
            <DialogDescription>{t('whatsapp.description')}</DialogDescription>
          </DialogHeader>

          {detail.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : recipients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              <p>{t('whatsapp.noNumber')}</p>
              <Link href={`/influencers/${influencerId}`} className="mt-2 inline-block font-medium text-brand hover:underline">
                {t('whatsapp.addNumber')}
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('whatsapp.sendTo')}>
                  <Select value={recipient?.key} onValueChange={setRecipientKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {recipients.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {r.label} · <LtrText>+{r.number}</LtrText>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t('whatsapp.language')}>
                  <div className="flex gap-1 rounded-lg border border-border p-1" role="radiogroup" aria-label={t('whatsapp.language')}>
                    {(['ar', 'en'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        role="radio"
                        aria-checked={lang === l}
                        onClick={() => setLang(l)}
                        className={cn(
                          'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
                          lang === l ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:bg-surface-muted',
                        )}
                      >
                        {l === 'ar' ? 'العربية' : 'English'}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <Field label={t('whatsapp.message')}>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={9}
                  dir={lang === 'ar' ? 'rtl' : 'ltr'}
                  className="font-sans leading-relaxed"
                />
              </Field>
            </div>
          )}

          <DialogFooter className="gap-2">
            {recipient ? (
              <>
                <Button type="button" variant="secondary" onClick={copy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t('whatsapp.copied') : t('whatsapp.copy')}
                </Button>
                <Button asChild>
                  <a
                    href={whatsappLink(recipient.number, text.trim())}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      log.mutate();
                      setOpen(false);
                    }}
                  >
                    {log.isPending ? <Spinner className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                    {t('whatsapp.open')}
                  </a>
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
