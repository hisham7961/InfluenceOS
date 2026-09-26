import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_TABS, absoluteAppUrl, appRoutePath, appRoutes } from '../utils/app-routes';

/**
 * Every link the server hands out must open a real page (P2.6: a usage-rights
 * alert and trend mentions pointed at pages that never existed). The pages
 * are read from the web app's `app/` folder, so adding or renaming a page is
 * checked automatically.
 */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const appDir = path.join(repo, 'apps/web/src/app');

/** Top-level sections of the app ("campaigns", "brands", …). */
const sectionNames = new Set<string>();

function pagePatterns(): RegExp[] {
  const out: RegExp[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name === 'api') continue;
        // Route groups "(app)" don't appear in the URL.
        const next = /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name];
        walk(path.join(dir, entry.name), next);
      } else if (entry.name === 'page.tsx') {
        if (segments[0]) sectionNames.add(segments[0]);
        const body = segments.map((s) => (/^\[.*\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|\\]/g, '\\$&'))).join('/');
        out.push(new RegExp(`^/${body}$`));
      }
    }
  };
  walk(appDir, []);
  return out;
}

const pages = pagePatterns();
const opens = (link: string) => pages.some((re) => re.test(appRoutePath(link)));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('app routes (P2.6)', () => {
  it('reads the web app pages', () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(opens('/campaigns/abc')).toBe(true);
    expect(opens('/brands/x/usage-rights/y')).toBe(false);
  });

  it('every builder opens a real page', () => {
    const id = 'ck1';
    const links = [
      appRoutes.home(),
      appRoutes.campaign(id),
      ...CAMPAIGN_TABS.map((tab) => appRoutes.campaign(id, tab)),
      appRoutes.campaignReport(id),
      appRoutes.brand('acme'),
      appRoutes.brandUsageRights(id),
      appRoutes.influencer(id),
      appRoutes.content(id),
      appRoutes.contentWall(),
      appRoutes.inspiration(),
      appRoutes.inspiration(id),
      appRoutes.logistics(),
      appRoutes.team(),
      appRoutes.finance(),
      appRoutes.exec(),
      appRoutes.notifications(),
      appRoutes.notificationSettings(),
      appRoutes.integrations(),
    ];
    const broken = links.filter((l) => !opens(l));
    expect(broken).toEqual([]);
  });

  it('the campaign tabs are the ones the workspace has', () => {
    const workspace = fs.readFileSync(path.join(appDir, '(app)/campaigns/[id]/workspace.tsx'), 'utf8');
    const tabs = new Set([...workspace.matchAll(/TabsTrigger value="([a-z-]+)"/g)].map((m) => m[1]));
    expect(CAMPAIGN_TABS.filter((t) => !tabs.has(t))).toEqual([]);
  });

  it('every link literal in the domain and worker opens a real page', () => {
    const roots = ['packages/domain/src', 'apps/worker/src'].map((r) => path.join(repo, r));
    const broken: string[] = [];
    // Any quoted path into one of the app's sections: `link: '/x'`,
    // `targetUrl = \`/campaigns/${id}\``, either side of a ternary, …
    const sections = [...sectionNames].join('|');
    const re = new RegExp(`(['"\`])(\\/(?:${sections})(?:[/?#][^'"\`\\s]*)?)\\1`, 'g');
    for (const file of roots.flatMap((r) => sourceFiles(r))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const link = m[2]!.replace(/\$\{[^}]*\}/g, 'x');
        if (!opens(link)) broken.push(`${path.relative(repo, file)}: ${m[2]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('builds absolute links for emails', () => {
    expect(absoluteAppUrl('https://app.example.com/', '/campaigns/1?tab=deliverables')).toBe(
      'https://app.example.com/campaigns/1?tab=deliverables',
    );
    expect(appRoutes.inspiration('a b')).toBe('/inspiration?item=a%20b');
  });
});
