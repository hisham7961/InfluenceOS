'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BadgeCheck, ShieldAlert } from 'lucide-react';
import type { CampaignLicenceCheckDTO } from '@influenceos/contracts';
import { appRoutes } from '@influenceos/shared';
import { Badge } from '@/components/ui/badge';
import { useCountryList, useCountryName } from '@/lib/country-names';
import { useLocalizedFormat } from '@/lib/format';

type CreatorCheck = CampaignLicenceCheckDTO['creators'][number];

/**
 * A roster row's licence standing for the campaign's countries (P3.5): one
 * "Licensed" badge when every country is covered, otherwise one badge per
 * country that isn't — each opens the creator's page, where licences are
 * kept.
 */
export function LicenceBadges({ check }: { check: CreatorCheck }) {
  const t = useTranslations('campaigns');
  const name = useCountryName();
  const list = useCountryList();
  const { shortDate } = useLocalizedFormat();
  const href = appRoutes.influencer(check.influencerId);

  if (check.ok) {
    return (
      <Badge
        tone="success"
        className="gap-1"
        title={t('licences.okTitle', { countries: list(check.checks.map((c) => c.countryCode)) })}
      >
        <BadgeCheck className="h-3 w-3" />
        {t('licences.ok')}
      </Badge>
    );
  }
  return (
    <>
      {check.checks
        .filter((c) => c.state !== 'VALID')
        .map((c) => (
          <Link
            key={c.countryCode}
            href={href}
            className="focus-visible:ring-ring rounded-full focus-visible:outline-none focus-visible:ring-2"
          >
            <Badge tone={c.state === 'EXPIRES_DURING' ? 'warning' : 'danger'} className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              {c.state === 'MISSING'
                ? t('licences.missing', { country: name(c.countryCode) })
                : c.state === 'EXPIRED'
                  ? t('licences.expired', { country: name(c.countryCode) })
                  : t('licences.endsDuring', {
                      country: name(c.countryCode),
                      date: shortDate(c.expiresAt),
                    })}
            </Badge>
          </Link>
        ))}
    </>
  );
}
