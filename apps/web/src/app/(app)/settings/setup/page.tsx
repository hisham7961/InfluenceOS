import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Database,
  HardDrive,
  KeyRound,
  Link2,
  ListChecks,
  Server,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import type { IntegrationDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getTranslations } from 'next-intl/server';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PlatformBadge } from '@/components/ui/platform-badge';

export const dynamic = 'force-dynamic';

/**
 * In-app setup & integrations guide. A single place that documents EVERYTHING
 * that can be configured — the required infrastructure, optional file storage,
 * and every social provider — with a live status pulled from the integrations
 * API so an operator can see, in the running system, exactly what still needs a
 * key. No secrets are shown here; keys are entered on Settings → Integrations.
 */

type SettingsT = Awaited<ReturnType<typeof getTranslations<'settings'>>>;

type EnvKey = { name: string; required?: boolean; noteKey?: string };
type ProviderGuide = {
  platform: 'YOUTUBE' | 'X' | 'INSTAGRAM' | 'TIKTOK' | 'SNAPCHAT';
  keys: EnvKey[];
};

// Ordered by ease/impact — YouTube first (turnkey, full content metrics).
const PROVIDERS: ProviderGuide[] = [
  {
    platform: 'YOUTUBE',
    keys: [{ name: 'YOUTUBE_API_KEY', required: true }],
  },
  {
    platform: 'X',
    keys: [{ name: 'X_API_BEARER_TOKEN', required: true }],
  },
  {
    platform: 'INSTAGRAM',
    keys: [
      { name: 'INSTAGRAM_ACCESS_TOKEN', required: true },
      { name: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', required: true, noteKey: 'instagramBusinessAccountId' },
    ],
  },
  {
    platform: 'TIKTOK',
    keys: [
      { name: 'TIKTOK_CLIENT_KEY', noteKey: 'tiktokOauthFoundation' },
      { name: 'TIKTOK_CLIENT_SECRET', noteKey: 'tiktokOauthFoundation' },
    ],
  },
  {
    platform: 'SNAPCHAT',
    keys: [],
  },
];

const CORE = [
  { id: 'database' as const, icon: Database, keys: ['DATABASE_URL', 'DIRECT_DATABASE_URL'] },
  { id: 'redis' as const, icon: Server, keys: ['REDIS_URL'] },
  { id: 'authSecret' as const, icon: KeyRound, keys: ['AUTH_SECRET'] },
  {
    id: 'firstAdmin' as const,
    icon: UserCog,
    keys: ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'BOOTSTRAP_ADMIN_NAME'],
  },
];

function KeyChip({ name, note }: { name: string; note?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{name}</code>
      {note ? <span className="text-xs text-muted-foreground">— {note}</span> : null}
    </span>
  );
}

/** Live status for one provider derived from the integrations capabilities. */
function providerStatus(
  t: SettingsT,
  dto: IntegrationDTO | undefined,
): { label: string; tone: 'success' | 'neutral' | 'warning'; live: boolean } {
  if (!dto) return { label: t('setup.providerStatus.manual'), tone: 'neutral', live: false };
  if (dto.capabilities.apiConfigured) return { label: t('setup.providerStatus.autoFetchActive'), tone: 'success', live: true };
  if (dto.capabilities.requiresCreatorAuthorization) {
    return { label: t('setup.providerStatus.needsCreatorOAuth'), tone: 'warning', live: false };
  }
  return { label: t('setup.providerStatus.manualNotConfigured'), tone: 'neutral', live: false };
}

export default async function SetupGuidePage() {
  const api = getServerApi();
  const t = await getTranslations('settings');
  const [me, integrations] = await Promise.all([
    api.auth.me(),
    api.integrations.list().catch((e) => {
      if (e instanceof ApiError) return [] as IntegrationDTO[];
      throw e;
    }),
  ]);
  const isAdmin = me.role === 'ADMIN';
  const byPlatform = new Map(integrations.map((i) => [i.platform, i]));
  const activeCount = PROVIDERS.filter((p) => byPlatform.get(p.platform)?.capabilities.apiConfigured).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t('setup.title')} description={t('setup.description')} />

      {/* Nothing-required callout */}
      <Card className="border-brand/30 bg-brand-soft/40">
        <CardContent className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{t('setup.coreCallout.title')}</p>
            <p className="text-muted-foreground">
              {t.rich('setup.coreCallout.body', {
                emphasis: (chunks) => <strong>{chunks}</strong>,
                active: activeCount,
                total: PROVIDERS.length,
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 1 — Core infrastructure */}
      <section className="space-y-3">
        <SectionTitle icon={ShieldCheck} n={1} title={t('setup.section.core.title')} hint={t('setup.section.core.hint')} />
        <div className="grid gap-4 md:grid-cols-2">
          {CORE.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-start gap-3 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <c.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{t(`setup.core.${c.id}.title`)}</p>
                    <Badge tone="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {t('setup.running')}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{t(`setup.core.${c.id}.body`)}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                    {c.keys.map((k) => (
                      <KeyChip key={k} name={k} />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 2 — File storage */}
      <section className="space-y-3">
        <SectionTitle icon={HardDrive} n={2} title={t('setup.section.storage.title')} hint={t('setup.section.storage.hint')} />
        <Card>
          <CardContent className="space-y-2 p-5 text-sm">
            <p>
              {t.rich('setup.storageBody', {
                strong: (chunks) => <strong>{chunks}</strong>,
                driver: () => <KeyChip name="STORAGE_DRIVER" />,
                endpoint: () => <KeyChip name="S3_INTERNAL_ENDPOINT" />,
                bucket: () => <KeyChip name="S3_BUCKET" />,
                accessKey: () => <KeyChip name="S3_ACCESS_KEY_ID" />,
                secretKey: () => <KeyChip name="S3_SECRET_ACCESS_KEY" />,
              })}
            </p>
            {isAdmin ? (
              <Link href="/settings/storage" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                {t('setup.openStorageSettings')} <ArrowRight className="rtl:-scale-x-100 h-3.5 w-3.5" />
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* 3 — Social providers (live) */}
      <section className="space-y-3">
        <SectionTitle
          icon={ListChecks}
          n={3}
          title={t('setup.section.social.title')}
          hint={t('setup.section.social.hint')}
        />
        <div className="grid gap-4">
          {PROVIDERS.map((p) => {
            const status = providerStatus(t, byPlatform.get(p.platform));
            const steps = t.raw(`setup.providers.${p.platform}.steps`) as string[];
            const limitationKey = `setup.providers.${p.platform}.limitation`;
            const limitation = t.has(limitationKey) ? t(limitationKey) : null;
            return (
              <Card key={p.platform}>
                <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
                  <PlatformBadge platform={p.platform} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{t(`setup.providers.${p.platform}.headline`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`setup.providers.${p.platform}.unlocks`)}</p>
                  </div>
                  <Badge tone={status.tone} className="gap-1 self-start">
                    {status.live ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
                    {status.label}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3 pt-0 text-sm">
                  {p.keys.length ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {p.keys.map((k) => (
                        <KeyChip
                          key={k.name}
                          name={k.name}
                          note={k.noteKey ? t(`setup.keyNotes.${k.noteKey}`) : undefined}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('setup.noKeysRequired')}</p>
                  )}
                  <ol className="list-decimal space-y-1 ps-5 text-muted-foreground">
                    {steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {limitation ? (
                    <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                      {limitation}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
            <p className="text-muted-foreground">
              {t.rich('setup.footerNote', { strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
            <Link href="/settings/integrations" className="inline-flex shrink-0 items-center gap-1 font-medium text-brand hover:underline">
              {t('setup.openIntegrations')} <ArrowRight className="rtl:-scale-x-100 h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* 4 — Creator connections */}
      <section className="space-y-3">
        <SectionTitle
          icon={Link2}
          n={4}
          title={t('setup.section.creatorConnections.title')}
          hint={t('setup.section.creatorConnections.hint')}
        />
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">{t('setup.creatorConnections.intro')}</p>
            <ol className="list-decimal space-y-1 ps-5 text-muted-foreground">
              <li>{t('setup.creatorConnections.step1')}</li>
              <li>
                {t('setup.creatorConnections.step2Prefix')}{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {'<OAUTH_CALLBACK_BASE_URL>/api/v1/integrations/<platform>/oauth/callback'}
                </code>
              </li>
              <li className="space-x-2">
                <span>{t('setup.creatorConnections.step3Prefix')}</span>
                <KeyChip name="INSTAGRAM_APP_ID" />
                <KeyChip name="INSTAGRAM_APP_SECRET" />
                <KeyChip name="TIKTOK_CLIENT_KEY" />
                <KeyChip name="TIKTOK_CLIENT_SECRET" />
                <KeyChip name="OAUTH_CALLBACK_BASE_URL" />
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">{t('setup.creatorConnections.outro')}</p>
          </CardContent>
        </Card>
      </section>

      {/* 5 — Verify */}
      <section className="space-y-3">
        <SectionTitle icon={CheckCircle2} n={5} title={t('setup.section.verify.title')} hint={t('setup.section.verify.hint')} />
        <Card>
          <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
            <p>{t.rich('setup.verify.body', { strong: (chunks) => <strong>{chunks}</strong> })}</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  n,
  title,
  hint,
}: {
  icon: typeof ShieldCheck;
  n: number;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-sm font-semibold text-brand">
        {n}
      </span>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-semibold leading-tight">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  );
}
