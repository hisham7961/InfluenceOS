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

type EnvKey = { name: string; required?: boolean; note?: string };
type ProviderGuide = {
  platform: 'YOUTUBE' | 'X' | 'INSTAGRAM' | 'TIKTOK' | 'SNAPCHAT';
  headline: string;
  unlocks: string;
  keys: EnvKey[];
  steps: string[];
  limitation?: string;
};

// Ordered by ease/impact — YouTube first (turnkey, full content metrics).
const PROVIDERS: ProviderGuide[] = [
  {
    platform: 'YOUTUBE',
    headline: 'Turnkey — recommended first',
    unlocks: 'Auto-fetch channel stats and video metrics (views / likes / comments), on add and on every scheduled refresh.',
    keys: [{ name: 'YOUTUBE_API_KEY', required: true }],
    steps: [
      'Google Cloud Console → create or select a project.',
      'Enable “YouTube Data API v3”.',
      'APIs & Services → Credentials → create an API key, restricted to the YouTube Data API.',
      'Paste it below as YOUTUBE_API_KEY (or set the env var and restart).',
    ],
  },
  {
    platform: 'X',
    headline: 'Key only — plan-dependent',
    unlocks: 'Auto-fetch profile public metrics and tweet metrics, subject to your API access tier.',
    keys: [{ name: 'X_API_BEARER_TOKEN', required: true }],
    steps: [
      'X Developer Portal → your project/app → generate a Bearer Token (App-only auth).',
      'Paste it below as X_API_BEARER_TOKEN.',
    ],
    limitation: 'The free tier is very limited; a 403 from X surfaces as “requires app authorization”.',
  },
  {
    platform: 'INSTAGRAM',
    headline: 'Profile lookup — Business/Creator accounts only',
    unlocks: 'Auto-fetch profile (name, avatar, bio, followers) for Professional target accounts via Business Discovery.',
    keys: [
      { name: 'INSTAGRAM_ACCESS_TOKEN', required: true },
      { name: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', required: true, note: 'the “self” account the lookup runs through' },
    ],
    steps: [
      'Connect an Instagram Business/Creator account to a Facebook Page you own.',
      'Meta for Developers → create an app → add “Instagram Graph API”.',
      'Generate a long-lived access token (instagram_basic, pages_read_engagement, Business Discovery).',
      'Find your connected IG Business account id. BOTH values are required — with only one, it stays inactive.',
    ],
    limitation: 'Does NOT give likes/comments/views of an arbitrary creator’s posts — that needs Creator connections (below).',
  },
  {
    platform: 'TIKTOK',
    headline: 'Embed + availability only',
    unlocks: 'Public video embed and an availability check work with no keys. Statistics require Creator connections (below).',
    keys: [
      { name: 'TIKTOK_CLIENT_KEY', note: 'for the creator-OAuth foundation' },
      { name: 'TIKTOK_CLIENT_SECRET', note: 'for the creator-OAuth foundation' },
    ],
    steps: [
      'No key needed for embeds/availability.',
      'For creator video stats, set up Creator connections (see the section below).',
    ],
  },
  {
    platform: 'SNAPCHAT',
    headline: 'Manual',
    unlocks: 'No public profile/content API. Snapchat is URL/manual-based; availability is a best-effort link check only.',
    keys: [],
    steps: ['Nothing to configure — data is entered manually.'],
  },
];

const CORE = [
  {
    icon: Database,
    title: 'PostgreSQL database',
    required: true,
    body: 'Primary data store. Set DATABASE_URL (and DIRECT_DATABASE_URL for migrations). Apply schema with “pnpm db:deploy”.',
    keys: ['DATABASE_URL', 'DIRECT_DATABASE_URL'],
  },
  {
    icon: Server,
    title: 'Redis',
    required: true,
    body: 'Backs the monitoring worker’s job queues (BullMQ) and the shared rate-limit store. Set REDIS_URL.',
    keys: ['REDIS_URL'],
  },
  {
    icon: KeyRound,
    title: 'Auth secret',
    required: true,
    body: 'Signs sessions and derives the key that encrypts stored provider secrets. Production requires ≥32 chars and a non-default value.',
    keys: ['AUTH_SECRET'],
  },
  {
    icon: UserCog,
    title: 'First administrator',
    required: true,
    body: 'Created once via “pnpm db:bootstrap”. Defaults to info@influence-op.com; in production you must supply BOOTSTRAP_ADMIN_PASSWORD from a secret store.',
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
function providerStatus(dto: IntegrationDTO | undefined): { label: string; tone: 'success' | 'neutral' | 'warning'; live: boolean } {
  if (!dto) return { label: 'Manual', tone: 'neutral', live: false };
  if (dto.capabilities.apiConfigured) return { label: 'Auto-fetch active', tone: 'success', live: true };
  if (dto.capabilities.requiresCreatorAuthorization) return { label: 'Needs creator OAuth', tone: 'warning', live: false };
  return { label: 'Manual (not configured)', tone: 'neutral', live: false };
}

export default async function SetupGuidePage() {
  const api = getServerApi();
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
      <PageHeader
        title="Setup Guide"
        description="Everything that can be configured — the required infrastructure, file storage, and every social integration — with its live status. No keys are shown here."
      />

      {/* Nothing-required callout */}
      <Card className="border-brand/30 bg-brand-soft/40">
        <CardContent className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Core features work with no external setup.</p>
            <p className="text-muted-foreground">
              The directory, campaigns, content, reports and the <strong>influencer CSV/JSON export</strong> all run
              out of the box. Everything below is <em>optional</em> — each key upgrades one social platform from manual
              entry to automatic fetching. You’re currently auto-fetching {activeCount} of {PROVIDERS.length} platforms.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 1 — Core infrastructure */}
      <section className="space-y-3">
        <SectionTitle icon={ShieldCheck} n={1} title="Core requirements" hint="Required to run at all — already satisfied if you can see this page." />
        <div className="grid gap-4 md:grid-cols-2">
          {CORE.map((c) => (
            <Card key={c.title}>
              <CardContent className="flex items-start gap-3 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <c.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{c.title}</p>
                    <Badge tone="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Running
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.body}</p>
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
        <SectionTitle icon={HardDrive} n={2} title="File storage" hint="For attachments and images." />
        <Card>
          <CardContent className="space-y-2 p-5 text-sm">
            <p>
              Two drivers, chosen with <KeyChip name="STORAGE_DRIVER" />: <strong>local</strong> (default, disk, no keys)
              or <strong>s3</strong> for S3/MinIO. Selecting s3 requires{' '}
              <KeyChip name="S3_INTERNAL_ENDPOINT" />, <KeyChip name="S3_BUCKET" />, <KeyChip name="S3_ACCESS_KEY_ID" /> and{' '}
              <KeyChip name="S3_SECRET_ACCESS_KEY" /> (the server refuses to start otherwise).
            </p>
            {isAdmin ? (
              <Link href="/settings/storage" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                Open Storage settings <ArrowRight className="h-3.5 w-3.5" />
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
          title="Social integrations"
          hint="All optional. Each upgrades one platform from manual to auto-fetch."
        />
        <div className="grid gap-4">
          {PROVIDERS.map((p) => {
            const status = providerStatus(byPlatform.get(p.platform));
            return (
              <Card key={p.platform}>
                <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
                  <PlatformBadge platform={p.platform} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{p.headline}</p>
                    <p className="text-xs text-muted-foreground">{p.unlocks}</p>
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
                        <KeyChip key={k.name} name={k.name} note={k.note} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No keys required.</p>
                  )}
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    {p.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {p.limitation ? (
                    <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                      {p.limitation}
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
              Enter any provider key <strong>encrypted at rest</strong> from the Integrations screen (admin) — no restart
              needed — or set the environment variable and restart.
            </p>
            <Link href="/settings/integrations" className="inline-flex shrink-0 items-center gap-1 font-medium text-brand hover:underline">
              Open Integrations <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* 4 — Creator connections */}
      <section className="space-y-3">
        <SectionTitle icon={Link2} n={4} title="Creator connections (Instagram / TikTok post metrics)" hint="Read a creator’s OWN post/video metrics." />
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p className="text-muted-foreground">
              The only lawful way to read a specific creator’s post/video metrics is for that creator to authorize the
              app, and for the app to pass the platform’s review (Meta / TikTok). The flow is wired end to end but stays
              inert — it says “not configured” rather than pretending — until you complete review and set the app keys.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Create the Meta / TikTok app and complete app review for the insight scopes.</li>
              <li>
                Register the redirect URI:{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {'<OAUTH_CALLBACK_BASE_URL>/api/v1/integrations/<platform>/oauth/callback'}
                </code>
              </li>
              <li className="space-x-2">
                <span>Set the app credentials:</span>
                <KeyChip name="INSTAGRAM_APP_ID" />
                <KeyChip name="INSTAGRAM_APP_SECRET" />
                <KeyChip name="TIKTOK_CLIENT_KEY" />
                <KeyChip name="TIKTOK_CLIENT_SECRET" />
                <KeyChip name="OAUTH_CALLBACK_BASE_URL" />
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Then a creator connects from their profile page (Creator connections card). This is a platform constraint
              (app review), not a code gap.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* 5 — Verify */}
      <section className="space-y-3">
        <SectionTitle icon={CheckCircle2} n={5} title="Verify it works" hint="Confirm a platform is live end to end." />
        <Card>
          <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
            <p>
              After adding a key, the platform card above flips to <strong>Auto-fetch active</strong>. To prove the fetch
              path, add an influencer from a real profile URL — a result marked <strong>Official API</strong> (not
              Manual) with real numbers confirms it. The Integrations screen also has a per-platform “test connection”.
            </p>
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
