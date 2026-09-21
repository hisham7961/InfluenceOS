'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Globe2, KeyRound, ShieldCheck, Tags, X } from 'lucide-react';
import type { BrandSummaryDTO, Capability, RoleProfile, UserAdminDetailDTO, UserRole } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { CAPABILITIES, COUNTRIES, ROLE_PROFILES, USER_ROLES, countryName } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { BidiText } from '@/components/common/bidi-text';

const NO_PROFILE = '__legacy__';
/** Tri-state per capability: undefined = follow the Role Profile default. */
type OverrideState = Record<string, boolean | undefined>;

/** Mirrors the server-side pairing rule in auth.service.ts's updateUser() —
 *  ADMIN/VIEWER profiles require the matching legacy role; the other four are
 *  all shadings of Staff. Disabling incompatible options here is a UX
 *  courtesy only; the server enforces this regardless. */
function profileCompatibleWithRole(profile: RoleProfile, role: UserRole): boolean {
  if (profile === 'ADMIN') return role === 'ADMIN';
  if (profile === 'VIEWER') return role === 'VIEWER';
  return role === 'STAFF';
}

export function UserEditSheet({
  userId,
  onOpenChange,
}: {
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = userId != null;
  const t = useTranslations('users');
  const tPerm = useTranslations('permissions');
  const tEnums = useTranslations('enums');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: () => api.users.getPermissions(userId as string),
    enabled: open,
  });
  const brandsQuery = useQuery({
    queryKey: ['brands-for-access'],
    queryFn: () => api.brands.list({ includeInactive: true }),
    enabled: open,
    staleTime: 60_000,
  });

  const detail = detailQuery.data;

  const [role, setRole] = React.useState<UserRole>('STAFF');
  const [isActive, setIsActive] = React.useState(true);
  const [roleProfile, setRoleProfile] = React.useState<RoleProfile | null>(null);
  const [overrides, setOverrides] = React.useState<OverrideState>({});
  const [countryCodes, setCountryCodes] = React.useState<Set<string>>(new Set());
  const [brandIds, setBrandIds] = React.useState<Set<string>>(new Set());
  const [countryFilter, setCountryFilter] = React.useState('');
  const [brandFilter, setBrandFilter] = React.useState('');

  // Hydrate local edit state whenever a (possibly new) user's detail loads.
  React.useEffect(() => {
    if (!detail) return;
    setRole(detail.role);
    setIsActive(detail.isActive);
    setRoleProfile(detail.roleProfile);
    const o: OverrideState = {};
    for (const c of detail.capabilityOverrides) o[c.capability] = c.granted;
    setOverrides(o);
    setCountryCodes(new Set(detail.countryCodes));
    setBrandIds(new Set(detail.brandIds));
  }, [detail]);

  // Permission Preview — recomputed from the CURRENT pending edits (role
  // profile + capability overrides), never saved until "Save changes" runs.
  const overrideList = React.useMemo(
    () =>
      Object.entries(overrides)
        .filter(([, v]) => v !== undefined)
        .map(([capability, granted]) => ({ capability: capability as Capability, granted: granted as boolean })),
    [overrides],
  );
  const previewQuery = useQuery({
    queryKey: ['permission-preview', userId, roleProfile, overrideList],
    queryFn: () => api.users.previewPermissions(userId as string, { roleProfile, overrides: overrideList }),
    enabled: open && !!detail,
    placeholderData: (prev) => prev,
  });

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId || !detail) return;
      if (role !== detail.role || isActive !== detail.isActive || roleProfile !== detail.roleProfile) {
        await api.users.update(userId, { role, isActive, roleProfile });
      }
      const originalOverrides = new Map(detail.capabilityOverrides.map((o) => [o.capability, o.granted]));
      const overridesChanged =
        overrideList.length !== originalOverrides.size ||
        overrideList.some((o) => originalOverrides.get(o.capability) !== o.granted);
      if (overridesChanged) await api.users.setCapabilities(userId, { overrides: overrideList });
      const countriesChanged =
        countryCodes.size !== detail.countryCodes.length || detail.countryCodes.some((c) => !countryCodes.has(c));
      if (countriesChanged) await api.users.setCountryAccess(userId, [...countryCodes]);
      const brandsChanged = brandIds.size !== detail.brandIds.length || detail.brandIds.some((b) => !brandIds.has(b));
      if (brandsChanged) await api.users.setBrandAccess(userId, [...brandIds]);
    },
    onSuccess: () => {
      toast.success(tPerm('editor.toastUpdated'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-permissions', userId] });
      close();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('editSheet.errorGeneric')),
  });

  const brands = brandsQuery.data ?? [];
  const filteredCountries = COUNTRIES.filter(
    (c) => !countryFilter.trim() || c.name.toLowerCase().includes(countryFilter.trim().toLowerCase()) || c.code.toLowerCase() === countryFilter.trim().toLowerCase(),
  );
  const filteredBrands = brands.filter((b) => !brandFilter.trim() || b.name.toLowerCase().includes(brandFilter.trim().toLowerCase()));

  const preview = previewQuery.data;
  const grantedCount = preview?.permissionPreview.filter((p) => p.granted).length ?? 0;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent side="right" className="sm:max-w-2xl gap-5">
        {detailQuery.isLoading || !detail ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-6 w-6 text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <BidiText>{detail.name}</BidiText>
              </SheetTitle>
              <SheetDescription>
                {t.rich('editSheet.description', {
                  email: (chunks) => <BidiText as="span">{chunks}</BidiText>,
                  value: detail.email,
                })}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('editSheet.legacyRole')}>
                <Select
                  value={role}
                  onValueChange={(v) => {
                    const nextRole = v as UserRole;
                    setRole(nextRole);
                    // A Role Profile that no longer pairs with the new legacy
                    // role would be rejected at Save — clear it up front
                    // rather than let the admin hit that error blind.
                    if (roleProfile && !profileCompatibleWithRole(roleProfile, nextRole)) setRoleProfile(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`list.roleLabel.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('editSheet.accountStatus')}>
                <div className="flex h-10 items-center gap-2">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm text-foreground">{isActive ? t('list.active') : t('list.inactive')}</span>
                </div>
              </Field>
            </div>

            <Field label={tPerm('editor.roleProfileLabel')} hint={tPerm('editor.roleProfileHint')}>
              <Select
                value={roleProfile ?? NO_PROFILE}
                onValueChange={(v) => setRoleProfile(v === NO_PROFILE ? null : (v as RoleProfile))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROFILE}>{tPerm('editor.noProfileOption')}</SelectItem>
                  {ROLE_PROFILES.map((p) => {
                    const compatible = profileCompatibleWithRole(p, role);
                    return (
                      <SelectItem key={p} value={p} disabled={!compatible}>
                        {enumLabel(tEnums, 'roleProfile', p)}
                        {!compatible ? tPerm('editor.incompatibleRoleSuffix') : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {roleProfile && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {tPerm(`editor.roleProfileDescription.${roleProfile}`)}
                </p>
              )}
            </Field>

            <Tabs defaultValue="capabilities">
              <TabsList>
                <TabsTrigger value="capabilities">{tPerm('editor.tabs.capabilities')}</TabsTrigger>
                <TabsTrigger value="countries">
                  {tPerm('editor.tabs.countries')}{' '}
                  {countryCodes.size > 0 && <span className="ms-1 text-muted-foreground">({countryCodes.size})</span>}
                </TabsTrigger>
                <TabsTrigger value="brands">
                  {tPerm('editor.tabs.brands')}{' '}
                  {brandIds.size > 0 && <span className="ms-1 text-muted-foreground">({brandIds.size})</span>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="capabilities">
                <p className="mb-2 text-xs text-muted-foreground">{tPerm('editor.capabilitiesTab.intro')}</p>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                  {CAPABILITIES.map((cap) => {
                    const line = preview?.permissionPreview.find((p) => p.capability === cap);
                    const state = overrides[cap];
                    return (
                      <div key={cap} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-muted/60">
                        <div className="flex min-w-0 items-center gap-2">
                          {line?.granted ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                          ) : (
                            <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                          )}
                          <span className="truncate text-sm text-foreground">{enumLabel(tEnums, 'capability', cap)}</span>
                        </div>
                        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border text-xs">
                          {(['revoke', 'default', 'grant'] as const).map((opt) => {
                            const active = opt === 'default' ? state === undefined : opt === 'grant' ? state === true : state === false;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() =>
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [cap]: opt === 'default' ? undefined : opt === 'grant',
                                  }))
                                }
                                className={cn(
                                  'px-2 py-1 transition-colors',
                                  active ? 'bg-accent text-accent-foreground' : 'bg-transparent text-muted-foreground hover:bg-surface-muted',
                                )}
                              >
                                {tPerm(`editor.capabilitiesTab.toggle.${opt}`)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="countries">
                <SearchInput
                  placeholder={tPerm('editor.countriesTab.searchPlaceholder')}
                  value={countryFilter}
                  onChange={(e) => setCountryFilter(e.target.value)}
                  className="mb-2"
                />
                <p className="mb-2 text-xs text-muted-foreground">
                  <Globe2 className="me-1 inline h-3 w-3" />
                  {countryCodes.size === 0
                    ? tPerm('editor.countriesTab.unrestricted')
                    : tPerm('editor.countriesTab.scoped', { count: countryCodes.size })}
                </p>
                <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-border p-2">
                  {filteredCountries.map((c) => (
                    <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted/60">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
                        checked={countryCodes.has(c.code)}
                        onChange={() =>
                          setCountryCodes((prev) => {
                            const next = new Set(prev);
                            next.has(c.code) ? next.delete(c.code) : next.add(c.code);
                            return next;
                          })
                        }
                      />
                      <span className="text-foreground">{countryName(c.code)}</span>
                      <span className="text-muted-foreground">{c.code}</span>
                    </label>
                  ))}
                  {filteredCountries.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">{tPerm('editor.countriesTab.noMatches')}</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="brands">
                <SearchInput
                  placeholder={tPerm('editor.brandsTab.searchPlaceholder')}
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  className="mb-2"
                />
                <p className="mb-2 text-xs text-muted-foreground">
                  <Tags className="me-1 inline h-3 w-3" />
                  {brandIds.size === 0
                    ? tPerm('editor.brandsTab.unrestricted')
                    : tPerm('editor.brandsTab.scoped', { count: brandIds.size })}
                </p>
                <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-border p-2">
                  {filteredBrands.map((b: BrandSummaryDTO) => (
                    <label key={b.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted/60">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
                        checked={brandIds.has(b.id)}
                        onChange={() =>
                          setBrandIds((prev) => {
                            const next = new Set(prev);
                            next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                            return next;
                          })
                        }
                      />
                      <span className="text-foreground">
                        <BidiText>{b.name}</BidiText>
                      </span>
                    </label>
                  ))}
                  {filteredBrands.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">{tPerm('editor.brandsTab.noMatches')}</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="rounded-xl border border-border bg-surface-muted/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />{' '}
                {tPerm('editor.preview.heading', { granted: grantedCount, total: CAPABILITIES.length })}
              </p>
              <div className="grid max-h-40 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto text-xs">
                {(preview?.permissionPreview ?? []).map((p) => (
                  <div key={p.capability} className={cn('flex items-center gap-1.5', p.granted ? 'text-foreground' : 'text-muted-foreground/60')}>
                    {p.granted ? <Check className="h-3 w-3 shrink-0 text-success" /> : <X className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{enumLabel(tEnums, 'capability', p.capability)}</span>
                    {p.isOverride && (
                      <Badge tone="accent" className="px-1 py-0 text-[10px]">
                        {tPerm('editor.preview.overrideBadge')}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={close}>
                {tCommon('cancel')}
              </Button>
              <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
                {save.isPending ? tCommon('saving') : t('editSheet.saveChanges')}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
