'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GULF_COUNTRY_CODES, useCountryName, useSortedCountries } from '@/lib/country-names';
import { cn } from '@/lib/cn';

/**
 * Pick several countries: the Gulf countries as one-tap chips, any other
 * country from a list. Used for a campaign's countries and for the
 * countries that need a creator licence.
 */
export function CountryMultiPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  const t = useTranslations('common');
  const name = useCountryName();
  const all = useSortedCountries();
  const selected = new Set(value);
  const quick: readonly string[] = GULF_COUNTRY_CODES;
  const others = value.filter((c) => !quick.includes(c));

  const toggle = (code: string) =>
    onChange(selected.has(code) ? value.filter((c) => c !== code) : [...value, code]);

  return (
    <div className="space-y-2" id={id}>
      <div className="flex flex-wrap gap-1.5">
        {quick.map((code) => {
          const on = selected.has(code);
          return (
            <button
              key={code}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(code)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                on
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted',
              )}
            >
              {on ? <Check className="h-3 w-3" /> : null}
              {name(code)}
            </button>
          );
        })}
        {others.map((code) => (
          <span
            key={code}
            className="border-brand bg-brand/10 text-brand inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
          >
            {name(code)}
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(code)}
              aria-label={t('removeItem', { name: name(code) })}
              className="hover:bg-brand/20 rounded-full"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <Select
        value=""
        onValueChange={(code) => code && !selected.has(code) && onChange([...value, code])}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 sm:w-64">
          <SelectValue placeholder={t('addCountry')} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {all
            .filter((c) => !selected.has(c.code) && !quick.includes(c.code))
            .map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
