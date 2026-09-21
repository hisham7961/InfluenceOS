import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Database,
  Flag,
  KeyRound,
  Languages,
  ListChecks,
  Mail,
  Moon,
  Palette,
  Plug,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Sun,
  UserCircle,
  Users,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { BidiText, LtrText } from '@/components/common/bidi-text';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const tCommon = await getTranslations('common');
  const user = await api.auth.me();
  const isAdmin = user.role === 'ADMIN';
  const isDark = user.theme?.toLowerCase() === 'dark';
  const isArabic = user.locale?.toLowerCase().startsWith('ar');

  return (
    <div>
      <PageHeader title={t('hub.title')} description={t('hub.description')} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {/* General — profile identity, spans two columns */}
        <NavCard
          href="/settings/general"
          icon={UserCircle}
          title={t('hub.cards.general.title')}
          description={t('hub.cards.general.description')}
          className="md:col-span-2"
        >
          <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} src={user.avatarUrl} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  <BidiText>{user.name}</BidiText>
                </p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <LtrText>{user.email}</LtrText>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge tone={isAdmin ? 'accent' : 'info'} className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                {isAdmin ? tCommon('administrator') : tCommon('staff')}
              </Badge>
              <Badge tone="neutral" className="gap-1">
                {isDark ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                {isDark ? t('hub.darkTheme') : t('hub.lightTheme')}
              </Badge>
              <Badge tone="neutral" className="gap-1">
                <Languages className="h-3 w-3" />
                {isArabic ? 'العربية' : 'English'}
              </Badge>
            </div>
          </div>
        </NavCard>

        <NavCard
          href="/settings/security"
          icon={KeyRound}
          title={t('hub.cards.security.title')}
          description={t('hub.cards.security.description')}
        />

        <NavCard
          href="/settings/setup"
          icon={ListChecks}
          title={t('hub.cards.setup.title')}
          description={t('hub.cards.setup.description')}
        />

        <NavCard
          href="/settings/integrations"
          icon={Plug}
          title={t('hub.cards.integrations.title')}
          description={t('hub.cards.integrations.description')}
        />

        <NavCard
          href="/settings/platform"
          icon={ServerCog}
          title={t('hub.cards.platform.title')}
          description={t('hub.cards.platform.description')}
        />

        {isAdmin ? (
          <NavCard
            href="/settings/users"
            icon={Users}
            title={t('hub.cards.users.title')}
            description={t('hub.cards.users.description')}
            badge={t('hub.adminBadge')}
          />
        ) : null}

        {isAdmin ? (
          <NavCard
            href="/settings/storage"
            icon={Database}
            title={t('hub.cards.storage.title')}
            description={t('hub.cards.storage.description')}
            badge={t('hub.adminBadge')}
          />
        ) : null}

        {isAdmin ? (
          <NavCard
            href="/settings/audit"
            icon={ScrollText}
            title={t('hub.cards.audit.title')}
            description={t('hub.cards.audit.description')}
            badge={t('hub.adminBadge')}
          />
        ) : null}

        <NavCard
          href="/settings/platform#flags"
          icon={Flag}
          title={t('hub.cards.featureFlags.title')}
          description={t('hub.cards.featureFlags.description')}
        />

        {/* Appearance & language — explains top bar controls, not a link */}
        <Card className="border-dashed">
          <CardHeader className="flex-row items-start gap-4 space-y-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Palette className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="text-base font-semibold leading-tight tracking-tight">{t('hub.appearance.title')}</p>
              <p className="text-sm text-muted-foreground">{t('hub.appearance.description')}</p>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

function NavCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  className,
  children,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className={`group block ${className ?? ''}`}>
      <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-elevated">
        <CardContent className="flex items-start gap-4 p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-white">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold leading-tight tracking-tight">{title}</p>
              {badge ? (
                <Badge tone="accent" className="shrink-0">
                  {badge}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand" />
        </CardContent>
        {children ? <div className="px-5 pb-5">{children}</div> : null}
      </Card>
    </Link>
  );
}
