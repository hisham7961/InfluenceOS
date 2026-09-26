import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P2.3 — the Finance page: a creator's fee shows under "To pay", a part
 * payment is recorded from there, it appears in the payments ledger and is
 * voided again (kept, struck through). The money rules themselves are
 * covered by the API integration suite (payment-ledger.test.ts).
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const V = '/api/bff/api/v1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  if ((await page.locator('html').getAttribute('lang')) !== 'en') {
    await page.request.patch(`${V}/auth/me/preferences`, { data: { locale: 'en' } });
    await page.evaluate(() => {
      document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
    });
    await page.reload();
  }
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${V}${url}`, { data });
  expect(res.ok(), `${url} → ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Finance: what is owed, record a part payment, void it', async ({ page }) => {
  test.slow();
  await signIn(page);

  const tag = `Fin E2E ${Date.now()}`;
  const brand = await post<{ id: string }>(page, '/brands', { name: `${tag} Brand` });
  const influencer = await post<{ id: string }>(page, '/influencers', { displayName: `${tag} Creator`, countryCode: 'KW' });
  const campaign = await post<{ id: string }>(page, '/campaigns', { brandId: brand.id, name: `${tag} Campaign`, currency: 'KWD' });
  await post(page, `/campaigns/${campaign.id}/influencers`, {
    influencerId: influencer.id,
    dealType: 'PAID',
    agreedCost: 500,
    currency: 'KWD',
  });

  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Finance', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search campaign, creator or item').fill(tag);
  const row = page.getByRole('row').filter({ hasText: `${tag} Creator` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('KWD 500.000');

  await row.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('spinbutton')).toHaveValue('500');
  await dialog.getByRole('spinbutton').fill('200');
  await dialog.getByPlaceholder('Transfer or cheque number').fill('E2E-TRX-1');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();
  // 300 still owed on the same row.
  await expect(row).toContainText('KWD 300.000');

  await page.getByRole('tab', { name: 'Payments' }).click();
  const paid = page.getByRole('row').filter({ hasText: 'E2E-TRX-1' });
  await expect(paid).toContainText('KWD 200.000');
  await paid.getByRole('button', { name: 'Void' }).click();
  const voidDialog = page.getByRole('dialog');
  await voidDialog.getByPlaceholder('e.g. Entered twice').fill('E2E check');
  await voidDialog.getByRole('button', { name: 'Void payment' }).click();
  await expect(page.getByText('Payment voided')).toBeVisible();
  await expect(paid).toHaveCount(0);

  // Voided payments stay on record.
  await page.getByRole('switch', { name: 'Show voided payments' }).click();
  await expect(paid).toContainText('Voided');

  // And the fee is fully owed again.
  await page.getByRole('tab', { name: 'To pay' }).click();
  await expect(row).toContainText('KWD 500.000');
});
