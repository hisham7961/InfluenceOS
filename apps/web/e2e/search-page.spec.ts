import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P3.7 — the full search page: from the quick palette ("See all results"),
 * a creator found only through a note shows with where it matched, the
 * type tabs carry counts, and it works on a phone.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const API = '/api/bff/api/v1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  await page.request.patch(`${API}/auth/me/preferences`, { data: { locale: 'en' } });
  await page.evaluate(() => {
    document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
  });
}

test('Search page: from the palette, notes found, tabs with counts, phone', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const stamp = Date.now();
  const token = `srch${stamp}`;
  const creator = (await (
    await page.request.post(`${API}/influencers`, {
      data: { displayName: `Quiet Creator ${stamp}`, countryCode: 'KW' },
    })
  ).json()) as { id: string };
  await page.request.post(`${API}/notes`, {
    data: { influencerId: creator.id, body: `Met at the ${token} launch` },
  });

  try {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByPlaceholder('Search influencers, campaigns, brands, content…').fill(token);
    await page.getByRole('option', { name: `See all results for “${token}”` }).click();
    await page.waitForURL(new RegExp(`/search\\?q=${token}`));

    const row = page.getByRole('link').filter({ hasText: `Quiet Creator ${stamp}` });
    await expect(row).toContainText('Matched a note');
    await expect(page.getByRole('tab', { name: /^Influencers\s*1$/ })).toBeVisible();
    await page.getByRole('tab', { name: /^Posts\s*0$/ }).click();
    await expect(page).toHaveURL(/type=published_content/);
    await expect(page.getByText(`Nothing matches “${token}”.`)).toBeVisible();
    await page.getByRole('tab', { name: /^All/ }).click();
    await row.click();
    await page.waitForURL(new RegExp(`/influencers/${creator.id}`));

    // On a phone, typing on the page updates the address and the results.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/search');
    await expect(page.getByText('Type a name, an @handle, a tag')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search everything' }).fill(token);
    await page.waitForURL(new RegExp(`q=${token}`));
    await expect(
      page.getByRole('link').filter({ hasText: `Quiet Creator ${stamp}` }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await page.request.delete(`${API}/influencers/${creator.id}`);
  }
});
