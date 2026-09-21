import Link from 'next/link';
import {
  ArrowRight,
  KeyRound,
  Languages,
  Mail,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  UserCircle,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { LocaleToggle } from '@/components/shell/locale-toggle';
import { BidiText, LtrText } from '@/components/common/bidi-text';

export const dynamic = 'force-dynamic';

export default async function GeneralSettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const tCommon = await getTranslations('common');
  const user = await api.auth.me();
  const isAdmin = user.role === 'ADMIN';
  const isDark = user.theme?.toLowerCase() === 'dark';
  const isArabic = user.locale?.toLowerCase().startsWith('ar');
  const roleValue = isAdmin ? tCommon('administrator') : tCommon('staff');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('general.title')} description={t('general.description')} />

      <div className="space-y-5">
        {/* Profile identity */}
        <Card>
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <Avatar name={user.name} src={user.avatarUrl} size="xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold leading-tight">
                  <BidiText>{user.name}</BidiText>
                </p>
                <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />
                  <LtrText>{user.email}</LtrText>
                </p>
              </div>
              <Badge tone={isAdmin ? 'accent' : 'info'} className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                {roleValue}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Read-only profile details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="h-4 w-4" /> {t('general.profileDetails.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <DetailRow label={t('general.profileDetails.name')} value={<BidiText>{user.name}</BidiText>} />
              <DetailRow label={t('general.profileDetails.email')} value={<LtrText>{user.email}</LtrText>} />
              <DetailRow label={t('general.profileDetails.role')} value={roleValue} />
              <DetailRow
                label={t('general.profileDetails.language')}
                value={isArabic ? t('general.profileDetails.arabicWithLabel') : 'English'}
              />
              <DetailRow
                label={t('general.profileDetails.theme')}
                value={isDark ? t('general.profileDetails.dark') : t('general.profileDetails.light')}
              />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">{t('general.profileDetails.managedNote')}</p>
          </CardContent>
        </Card>

        {/* Appearance & language preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-4 w-4" /> {t('general.appearance.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                {isDark ? (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">{t('general.appearance.themeLabel')}</span>
                <span className="text-muted-foreground">{t('general.appearance.themeHint')}</span>
              </div>
              <ThemeToggle />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{t('general.appearance.languageLabel')}</span>
                <span className="text-muted-foreground">{t('general.appearance.languageHint')}</span>
              </div>
              <LocaleToggle />
            </div>
            <p className="text-xs text-muted-foreground">{t('general.appearance.savedNote')}</p>
          </CardContent>
        </Card>

        {/* Link to security for password & sessions */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <KeyRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t('general.passwordSessions.title')}</p>
                <p className="text-sm text-muted-foreground">{t('general.passwordSessions.description')}</p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/settings/security">
                {t('general.passwordSessions.cta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
