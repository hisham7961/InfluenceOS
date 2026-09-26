import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

/**
 * P3.1 — Sales & ROI in the campaign workspace: give a creator a promo code
 * and a tracking link, follow the short link without signing in, paste the
 * shop's orders, check them before saving, import, and undo the file.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  if ((await page.locator('html').getAttribute('lang')) !== 'en') {
    await page.request.patch('/api/bff/api/v1/auth/me/preferences', { data: { locale: 'en' } });
    await page.evaluate(() => {
      document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
    });
    await page.reload();
  }
}

/** A campaign with at least one creator on its roster. */
async function campaignWithRoster(page: Page): Promise<{ id: string; creator: string }> {
  const list = (await (await page.request.get('/api/bff/api/v1/campaigns?pageSize=50')).json()) as { data: { id: string }[] };
  for (const c of list.data) {
    const roster = (await (await page.request.get(`/api/bff/api/v1/campaigns/${c.id}/influencers`)).json()) as {
      influencer: { displayName: string };
    }[];
    if (roster.length) return { id: c.id, creator: roster[0]!.influencer.displayName };
  }
  throw new Error('No campaign with a roster in the seed data');
}

test('Sales & ROI: code, tracking link, pasted shop orders checked then imported, and undone', async ({ page, baseURL }) => {
  await signIn(page);
  const { id, creator } = await campaignWithRoster(page);
  const stamp = Date.now().toString(36).toUpperCase();
  const code = `E2E${stamp}`;

  await page.goto(`/campaigns/${id}?tab=sales`);
  await expect(page.getByRole('tab', { name: 'Overview', exact: true }).first()).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tab', { name: 'Sales & ROI' })).toHaveAttribute('data-state', 'active');

  // A promo code for the first creator on the roster.
  await page.getByRole('button', { name: 'Add code' }).click();
  const codeDialog = page.getByRole('dialog');
  await codeDialog.getByRole('combobox', { name: 'Creator' }).click();
  await page.getByRole('option', { name: creator }).first().click();
  await codeDialog.getByPlaceholder('SARA15').fill(code);
  await codeDialog.locator('input[type="date"]').first().fill('2026-01-01');
  await codeDialog.getByRole('button', { name: 'Add code' }).click();
  await expect(page.getByText('Code added')).toBeVisible();
  await expect(page.getByText(code, { exact: true }).first()).toBeVisible();

  // A tracking link.
  await page.getByRole('button', { name: 'New link' }).click();
  const linkDialog = page.getByRole('dialog');
  await linkDialog.getByRole('combobox', { name: 'Creator' }).click();
  await page.getByRole('option', { name: creator }).first().click();
  await linkDialog.getByPlaceholder('https://').fill('https://shop.example.com/glow');
  await linkDialog.getByPlaceholder(/Bio link/).fill(`E2E ${stamp}`);
  await linkDialog.getByRole('button', { name: 'New link' }).click();
  await expect(page.getByText(/Link created/)).toBeVisible();
  const sales = (await (await page.request.get(`/api/bff/api/v1/campaigns/${id}/sales`)).json()) as {
    links: { slug: string; label: string | null }[];
  };
  const slug = sales.links.find((l) => l.label === `E2E ${stamp}`)!.slug;
  await expect(page.getByText(`/r/${slug}`)).toBeVisible();

  // The short link works for anyone, without signing in, and tags the visit.
  const anonymous = await playwrightRequest.newContext({ baseURL });
  const res = await anonymous.get(`/r/${slug}`, {
    maxRedirects: 0,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0' },
  });
  expect(res.status()).toBe(302);
  const location = new URL(res.headers()['location']!);
  expect(location.host).toBe('shop.example.com');
  expect(location.searchParams.get('utm_content')).toBe(slug);
  expect((await anonymous.get('/r/nope123', { maxRedirects: 0 })).status()).toBe(404);
  await anonymous.dispose();

  // Paste the shop's orders from Excel, check, then import.
  await page.reload();
  await expect(page.getByText('1 click').first()).toBeVisible();
  await page.getByRole('button', { name: 'Import orders' }).click();
  const importDialog = page.getByRole('dialog');
  await importDialog
    .getByPlaceholder(/Order/)
    .fill(`Order\tDate\tTotal\tDiscount code\nE2E-1-${stamp}\t01/09/2026\t12.500\t${code}\nE2E-2-${stamp}\t02/09/2026\t7.500\tNOPE${stamp}\n`);
  await expect(importDialog.getByText('2 rows read')).toBeVisible();
  await importDialog.getByRole('button', { name: 'Check the file' }).click();
  await expect(importDialog.getByText('1 order to credit')).toBeVisible();
  await expect(importDialog.getByText(`Codes not set up for this brand: NOPE${stamp} (1)`)).toBeVisible();
  await importDialog.getByRole('button', { name: 'Import 1 order' }).click();
  await expect(page.getByText('1 order imported')).toBeVisible();
  await expect(page.getByText(`E2E-1-${stamp}`, { exact: true })).toBeVisible();

  // Undo the whole file.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('1 order removed')).toBeVisible();
  await expect(page.getByText(`E2E-1-${stamp}`, { exact: true })).toHaveCount(0);

  // Tidy up: the code has no sales left, so it can be deleted; so can the link.
  await page.getByRole('button', { name: `Delete ${code}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Code deleted')).toBeVisible();
  await page.getByRole('button', { name: `Delete link E2E ${stamp}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Link deleted')).toBeVisible();
});

test('Sales & ROI in Arabic on a phone: no sideways scroll', async ({ page }) => {
  await signIn(page);
  const { id } = await campaignWithRoster(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.cookie = 'locale=ar; path=/; max-age=31536000; samesite=lax';
  });
  await page.goto(`/campaigns/${id}?tab=sales`);
  await expect(page.getByRole('tab', { name: 'المبيعات والعائد' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText('أكواد الخصم').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
  });
});
