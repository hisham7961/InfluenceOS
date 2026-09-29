import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * A confirmed creator who gets products lands in Logistics by itself, and the
 * roster says where their products stand — red when someone has to act. A
 * gifted creator with no address on file gets a request Logistics can't send
 * (red "no address"); a paid creator doesn't get products, but one click
 * sends them some anyway. Both requests show on the Logistics page.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const API = '/api/bff/api/v1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  await setLocale(page, 'en');
}

async function setLocale(page: Page, locale: 'en' | 'ar') {
  await page.request.patch(`${API}/auth/me/preferences`, { data: { locale } });
  await page.evaluate((l) => {
    document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
  }, locale);
}

test('Shipments follow the roster: red until Logistics has what it needs', async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page);
  const stamp = Date.now();
  const brands = (await (await page.request.get(`${API}/brands`)).json()) as { id: string }[];
  const brandId = brands[0]!.id;
  const campaign = (await (
    await page.request.post(`${API}/campaigns`, {
      data: { brandId, name: `E2E Ship ${stamp}`, status: 'ACTIVE' },
    })
  ).json()) as { id: string };

  async function onRoster(
    name: string,
    deal: 'GIFTED_PRODUCT' | 'PAID',
    address: Record<string, string>,
  ) {
    const creator = (await (
      await page.request.post(`${API}/influencers`, {
        data: { displayName: name, countryCode: 'KW', ...address },
      })
    ).json()) as { id: string };
    await page.request.post(`${API}/brand-influencers`, {
      data: { brandId, influencerId: creator.id },
    });
    const res = await page.request.post(`${API}/campaigns/${campaign.id}/influencers`, {
      data: {
        campaignId: campaign.id,
        influencerId: creator.id,
        dealType: deal,
        participationStatus: 'CONFIRMED',
      },
    });
    expect(res.status()).toBe(201);
  }

  const gifted = `E2E Gifted ${stamp}`;
  const paid = `E2E Paid ${stamp}`;
  await onRoster(gifted, 'GIFTED_PRODUCT', {});
  await onRoster(paid, 'PAID', {
    addressLine1: 'Block 1, Street 2, House 3',
    city: 'Salmiya',
    mobile: '+96550002222',
  });

  try {
    await page.goto(`/campaigns/${campaign.id}?tab=influencers`);
    // The gifted creator's request was made on confirming — but it has no address: red.
    const missing = page.locator('[data-testid="creator-logistics"] [data-state="ADDRESS_MISSING"]');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('Shipment has no address');
    await expect(missing).toHaveClass(/text-danger/);

    // The paid creator gets nothing by default — and can be sent products anyway.
    await expect(page.getByText('No products to send')).toBeVisible();
    await page.getByRole('button', { name: 'Send products anyway' }).click();
    await expect(page.getByText('Shipment request added to Logistics.')).toBeVisible();
    await expect(
      page.locator('[data-testid="creator-logistics"] [data-state="REQUESTED"]'),
    ).toContainText('Shipment requested');

    // Both are in the Logistics list — the same rows, never a copy.
    await page.goto(`/logistics?campaignId=${campaign.id}`);
    await expect(page.getByText(gifted).first()).toBeVisible();
    await expect(page.getByText(paid).first()).toBeVisible();

    // Arabic.
    await setLocale(page, 'ar');
    await page.goto(`/campaigns/${campaign.id}?tab=influencers`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('الشحنة بلا عنوان')).toBeVisible();
    await expect(page.getByText('طُلبت الشحنة')).toBeVisible();
  } finally {
    await setLocale(page, 'en');
  }
});
