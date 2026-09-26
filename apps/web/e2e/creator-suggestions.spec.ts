import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P3.7 — suggested creators on a campaign's sourcing tab: a creator whose
 * audience is in the campaign's country (and who lives there) is suggested
 * with the reasons, and one click adds them to the sourcing list. Iceland
 * keeps the ranking to this test's creator.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const V = '/api/bff/api/v1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  await page.request.patch(`${V}/auth/me/preferences`, { data: { locale: 'en' } });
  await page.evaluate(() => {
    document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
  });
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${V}${url}`, { data });
  expect(res.ok(), `${url} → ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Suggested creators: reasons shown, one click to the sourcing list', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const stamp = Date.now();
  const tag = `Sug E2E ${stamp}`;
  const brand = await post<{ id: string }>(page, '/brands', { name: `${tag} Brand` });
  const campaign = await post<{ id: string }>(page, '/campaigns', {
    brandId: brand.id,
    name: `${tag} Campaign`,
    marketCountryCodes: ['IS'],
  });
  const name = `${tag} Ice`;
  const creator = await post<{ id: string }>(page, '/influencers', {
    displayName: name,
    countryCode: 'IS',
  });
  let candidateId: string | null = null;

  try {
    const account = await post<{ id: string }>(page, `/influencers/${creator.id}/social-accounts`, {
      influencerId: creator.id,
      platform: 'INSTAGRAM',
      username: `sug_${stamp}`,
      followers: 20_000,
    });
    await post(page, `/social-accounts/${account.id}/audience`, {
      capturedAt: '2026-09-01',
      countries: [{ countryCode: 'IS', pct: 60 }],
    });

    await page.goto(`/campaigns/${campaign.id}?tab=sourcing`);
    const panel = page.getByRole('region', { name: 'Suggested for this campaign' });
    await expect(panel).toContainText('matched on audience in Iceland');
    const row = panel.getByRole('listitem').first();
    await expect(row).toContainText(name);
    await expect(row).toContainText('60% of audience in Iceland');
    await expect(row).toContainText('Based in Iceland');
    await expect(row).toContainText('Match 45');

    await row.getByRole('button', { name: `Consider ${name}` }).click();
    await expect(page.getByText(`${name} added to the pipeline`)).toBeVisible();
    // Now on the list (with the match as the fit score), and no longer suggested.
    const listed = page.getByRole('row').filter({ hasText: name });
    await expect(listed).toContainText('45');
    await expect(panel.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);

    const candidates = (await (
      await page.request.get(`${V}/campaigns/${campaign.id}/candidates`)
    ).json()) as {
      id: string;
      fitScore: number | null;
    }[];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fitScore).toBe(45);
    candidateId = candidates[0]!.id;
  } finally {
    if (candidateId) await page.request.delete(`${V}/candidates/${candidateId}`);
    await page.request.delete(`${V}/influencers/${creator.id}`);
  }
});
