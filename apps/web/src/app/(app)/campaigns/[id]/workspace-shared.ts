import * as React from 'react';
import type { ScriptDTO } from '@influenceos/contracts';

/** Small helpers shared by the campaign workspace's tabs. */

/** Sentinel for "no influencer attributed" in the expense form's Select (Radix forbids an empty-string value). */
export const NONE = 'none';

/** ISO/date string → yyyy-mm-dd for a native date input (local calendar day). */
export function toDateInputValue(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Split a comma/newline-separated string into a trimmed, de-duped string[]. */
export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** The campaign's scripts, for linking one to a deliverable. */
export const CampaignScriptsContext = React.createContext<ScriptDTO[]>([]);
