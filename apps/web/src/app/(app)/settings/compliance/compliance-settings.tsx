'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeCheck } from 'lucide-react';
import type { ComplianceSettingsDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useCountryList } from '@/lib/country-names';
import { CountryMultiPicker } from '@/components/common/country-multi-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ComplianceSettings({
  initial,
  canEdit,
}: {
  initial: ComplianceSettingsDTO;
  canEdit: boolean;
}) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const list = useCountryList();
  const [saved, setSaved] = React.useState(initial.licenceCountryCodes);
  const [codes, setCodes] = React.useState(initial.licenceCountryCodes);
  const dirty = codes.length !== saved.length || codes.some((c) => !saved.includes(c));

  const save = useMutation({
    mutationFn: () => api.licences.updateSettings({ licenceCountryCodes: codes }),
    onSuccess: (res) => {
      setSaved(res.licenceCountryCodes);
      toast.success(t('compliance.savedToast'));
      queryClient.invalidateQueries({ queryKey: qk.complianceSettings });
      // Rosters and Needs Attention check against this list.
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4" /> {t('compliance.licences.title')}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t('compliance.licences.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit ? (
          <>
            <CountryMultiPicker value={codes} onChange={setCodes} disabled={save.isPending} />
            <p className="text-muted-foreground text-xs">
              {codes.length
                ? t('compliance.licences.current', { countries: list(codes) })
                : t('compliance.licences.none')}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => setCodes(saved)}
              >
                {tCommon('cancel')}
              </Button>
              <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? tCommon('saving') : tCommon('save')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">{saved.length ? list(saved) : t('compliance.licences.none')}</p>
            <p className="text-muted-foreground text-xs">{t('compliance.licences.adminOnly')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
