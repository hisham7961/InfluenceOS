import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P2.2 — the client report: opened from the campaign, switched to Arabic
 * (right to left, Arabic headings), costs switched off, and the Excel
 * workbook downloaded under the campaign's name. The numbers themselves are
 * covered by the API integration suite (campaign-report.test.ts).
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };

async function switchToEnglish(page: Page) {
  await page.request.patch('/api/bff/api/v1/auth/me/preferences', { data: { locale: 'en' } });
  await page.evaluate(() => {
    document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
  });
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  if ((await page.locator('html').getAttribute('lang')) !== 'en') {
    await switchToEnglish(page);
    await page.reload();
  }
}

test('Client report: English and Arabic, costs off, Excel download', async ({ page }) => {
  test.slow();
  await signIn(page);

  const list = await page.request.get('/api/bff/api/v1/campaigns?pageSize=1');
  expect(list.ok()).toBeTruthy();
  const campaign = ((await list.json()) as { data: { id: string; name: string }[] }).data[0]!;

  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('link', { name: 'Client report' }).click();
  await page.waitForURL(/\/report/);
  const report = page.locator('article');
  await expect(report).toHaveAttribute('dir', 'ltr');
  await expect(report.getByRole('heading', { name: 'Results against targets' })).toBeVisible();
  await expect(report.getByRole('heading', { level: 1 })).toContainText(campaign.name);

  // The brand's language, independent of the viewer's own.
  await page.getByRole('link', { name: 'العربية' }).click();
  await page.waitForURL(/lang=ar/);
  await expect(report).toHaveAttribute('dir', 'rtl');
  await expect(report.getByRole('heading', { name: 'النتائج مقابل المستهدف' })).toBeVisible();
  // The rest of the app stays in the viewer's language.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download Excel' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-report-ar\.xlsx$/);

  // Costs off: no spend figure in the report.
  await page.getByRole('switch', { name: 'Include costs' }).click();
  await page.waitForURL(/costs=0/);
  await expect(report.getByText('الإنفاق')).toHaveCount(0);
  await expect(report.getByRole('heading', { name: 'النتائج مقابل المستهدف' })).toBeVisible();
});
