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
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { LocaleToggle } from '@/components/shell/locale-toggle';

export const dynamic = 'force-dynamic';

export default async function GeneralSettingsPage() {
  const api = getServerApi();
  const user = await api.auth.me();
  const isAdmin = user.role === 'ADMIN';
  const isDark = user.theme?.toLowerCase() === 'dark';
  const isArabic = user.locale?.toLowerCase().startsWith('ar');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="General"
        description="Your profile, contact details, and account preferences."
      />

      <div className="space-y-5">
        {/* Profile identity */}
        <Card>
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <Avatar name={user.name} src={user.avatarUrl} size="xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold leading-tight">{user.name}</p>
                <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />
                  {user.email}
                </p>
              </div>
              <Badge tone={isAdmin ? 'accent' : 'info'} className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                {isAdmin ? 'Administrator' : 'Staff'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Read-only profile details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="h-4 w-4" /> Profile details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <DetailRow label="Name" value={user.name} />
              <DetailRow label="Email" value={user.email} />
              <DetailRow label="Role" value={isAdmin ? 'Administrator' : 'Staff'} />
              <DetailRow label="Language" value={isArabic ? 'العربية (Arabic)' : 'English'} />
              <DetailRow label="Theme" value={isDark ? 'Dark' : 'Light'} />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              These identity details are managed by your workspace administrator and can&apos;t be
              edited here.
            </p>
          </CardContent>
        </Card>

        {/* Appearance & language preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-4 w-4" /> Appearance & language
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
                <span className="font-medium">Theme</span>
                <span className="text-muted-foreground">Switch between light and dark</span>
              </div>
              <ThemeToggle />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Language</span>
                <span className="text-muted-foreground">English or العربية (RTL)</span>
              </div>
              <LocaleToggle />
            </div>
            <p className="text-xs text-muted-foreground">
              Changes apply instantly and are saved to your account, so they follow you to any
              device you sign in on.
            </p>
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
                <p className="text-sm font-semibold">Password & sessions</p>
                <p className="text-sm text-muted-foreground">
                  Change your password and manage the devices signed in to your account.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/settings/security">
                Go to Security
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
