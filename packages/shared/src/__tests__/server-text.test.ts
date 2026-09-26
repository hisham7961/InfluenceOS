import { describe, expect, it } from 'vitest';
import {
  createServerTextMatcher,
  fillTemplate,
  translateServerMessage,
} from '../utils/server-text';

const en = {
  a_messaged: '{name} messaged {displayName} {via}{value}.',
  a_messaged_on_whatsapp: '{name} messaged {displayName} on WhatsApp.',
  a_messaged_via: '{name} messaged {displayName} ({contactMethod}).',
  a_changed_s_role_from: "{name} changed {name2}'s role from {role} to {role2}.",
  a_added_published_post: '{name} added a post published on {platform}.',
  a_recorded_licence: "{name} recorded {name2}'s advertising licence in {countryCode}.",
  a_bulk_added: '{name} bulk-added {count} creator{value} to {campaign}.',
};
const ar: Record<string, string> = {
  a_messaged: '{name} راسل {displayName} {via}{value}.',
  a_messaged_on_whatsapp: '{name} راسل {displayName} عبر واتساب.',
  a_messaged_via: '{name} راسل {displayName} ({contactMethod}).',
  a_changed_s_role_from: '{name} غيّر دور {name2} من {role} إلى {role2}.',
  a_added_published_post: '{name} أضاف منشورًا تم نشره على {platform}.',
  a_recorded_licence: '{name} سجّل رخصة {name2} في {countryCode}.',
  a_bulk_added: '{name} أضاف {count} من المؤثرين إلى {campaign}.',
};
const enEnums = {
  contactMethod: { WHATSAPP: 'WhatsApp', INSTAGRAM_DM: 'Instagram DM' },
  role: { ADMIN: 'Admin', STAFF: 'Staff', VIEWER: 'Viewer' },
  roleProfile: { VIEWER: 'Viewer' },
  platform: { INSTAGRAM: 'Instagram' },
};
const arEnums: Record<string, Record<string, string>> = {
  contactMethod: { WHATSAPP: 'واتساب', INSTAGRAM_DM: 'رسالة إنستغرام' },
  role: { ADMIN: 'مسؤول', STAFF: 'موظف', VIEWER: 'مشاهِد' },
  roleProfile: { VIEWER: 'مشاهِد' },
  platform: { INSTAGRAM: 'Instagram' },
  country: { KW: 'الكويت' },
};

const matcher = createServerTextMatcher(en, enEnums);
const strip = (s: string) => s.replace(/[⁨⁩]/g, '');
function toArabic(text: string): string {
  return strip(
    translateServerMessage(
      matcher,
      text,
      (key, params) => fillTemplate(ar[key]!, params),
      (ref) => {
        const [group, key] = ref.split('.');
        const label = arEnums[group!]?.[key!];
        if (!label) throw new Error(ref);
        return label;
      },
    ),
  );
}

describe('server text', () => {
  it('picks the specific template over the generic one', () => {
    expect(toArabic('Sara messaged Nour Haddad on WhatsApp.')).toBe(
      'Sara راسل Nour Haddad عبر واتساب.',
    );
    expect(toArabic('Sara messaged Nour Haddad (instagram dm).')).toBe(
      'Sara راسل Nour Haddad (رسالة إنستغرام).',
    );
  });

  it('translates a value from the enum group named like its placeholder', () => {
    expect(toArabic("Sara changed Ali's role from STAFF to VIEWER.")).toBe(
      'Sara غيّر دور Ali من موظف إلى مشاهِد.',
    );
  });

  it('turns a country code into a country reference', () => {
    expect(toArabic("Sara recorded Ali's advertising licence in KW.")).toBe(
      'Sara سجّل رخصة Ali في الكويت.',
    );
  });

  it('matches the singular form, where the plural "s" is empty', () => {
    expect(toArabic('Sara bulk-added 1 creator to Launch.')).toBe(
      'Sara أضاف 1 من المؤثرين إلى Launch.',
    );
    expect(toArabic('Sara bulk-added 3 creators to Launch.')).toBe(
      'Sara أضاف 3 من المؤثرين إلى Launch.',
    );
  });

  it('keeps a typed name as written unless it is a key of its own group', () => {
    expect(toArabic('Viewer added a post published on INSTAGRAM.')).toBe(
      'Viewer أضاف منشورًا تم نشره على Instagram.',
    );
  });

  it('returns unknown text unchanged', () => {
    expect(toArabic('Something new happened.')).toBe('Something new happened.');
  });
});
