import { expect, test, type Page } from '@playwright/test';

/**
 * P3.5 — creator licences: a campaign aimed at Kuwait flags a creator with
 * no Kuwaiti licence on its roster; the badge opens the creator's page,
 * where the licence (with its scanned copy) is recorded; the roster then
 * shows the creator as licensed. The creator's page and the compliance
 * settings are checked in Arabic on a phone too.
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

test('Creator licences: flagged on the roster, recorded on the creator, then licensed', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const stamp = Date.now();

  // Kuwait needs a licence (restored afterwards).
  const settings = (await (await page.request.get(`${API}/compliance/settings`)).json()) as {
    licenceCountryCodes: string[];
  };
  await page.request.put(`${API}/compliance/settings`, {
    data: { licenceCountryCodes: ['KW', 'SA', 'AE'] },
  });

  // A campaign aimed at Kuwait, with a new creator on it.
  const brands = (await (await page.request.get(`${API}/brands`)).json()) as { id: string }[];
  const brandId = brands[0]!.id;
  const campaign = (await (
    await page.request.post(`${API}/campaigns`, {
      data: { brandId, name: `E2E Licence ${stamp}`, status: 'ACTIVE', marketCountryCodes: ['KW'] },
    })
  ).json()) as { id: string };
  const creator = (await (
    await page.request.post(`${API}/influencers`, {
      data: { displayName: `E2E Licensee ${stamp}`, countryCode: 'KW' },
    })
  ).json()) as { id: string };
  await page.request.post(`${API}/brand-influencers`, {
    data: { brandId, influencerId: creator.id },
  });
  await page.request.post(`${API}/campaigns/${campaign.id}/influencers`, {
    data: { campaignId: campaign.id, influencerId: creator.id, participationStatus: 'CONFIRMED' },
  });

  try {
    await page.goto(`/campaigns/${campaign.id}?tab=influencers`);
    const badge = page.getByText('No licence: Kuwait');
    await expect(badge).toBeVisible();

    // The badge opens the creator's page; record the licence there.
    await badge.click();
    await page.waitForURL(new RegExp(`/influencers/${creator.id}`));
    const card = page.locator('#licences');
    await expect(card.getByText('No licences recorded yet.')).toBeVisible();
    await card.getByRole('button', { name: 'Add licence' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: 'Country' })).toContainText('Kuwait');
    await dialog.getByLabel('Issued by').fill('Ministry of Commerce');
    await dialog.getByLabel('Licence number').fill('KW-E2E-1');
    const nextYear = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
    await dialog.getByLabel('Valid until').fill(nextYear);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'licence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
    });
    await expect(dialog.getByText('licence.pdf')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Licence saved')).toBeVisible();
    await expect(card.getByText('Kuwait')).toBeVisible();
    await expect(card.getByText('Valid', { exact: true })).toBeVisible();
    await expect(card.getByText('KW-E2E-1')).toBeVisible();
    await expect(card.getByRole('button', { name: /licence\.pdf/ })).toBeVisible();

    // Back on the roster the creator is licensed.
    await page.goto(`/campaigns/${campaign.id}?tab=influencers`);
    await expect(page.getByText('Licensed', { exact: true })).toBeVisible();
    await expect(page.getByText('No licence: Kuwait')).toHaveCount(0);

    // Arabic, on a phone: the creator's licences and the compliance settings.
    await setLocale(page, 'ar');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/influencers/${creator.id}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#licences').getByText('رخص الإعلان')).toBeVisible();
    await expect(page.locator('#licences').getByText('الكويت')).toBeVisible();
    await expect(page.locator('#licences').getByText('سارية', { exact: true })).toBeVisible();
    await page.goto('/settings/compliance');
    await expect(page.getByRole('button', { name: /الكويت/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await setLocale(page, 'en');
    await page.request.put(`${API}/compliance/settings`, {
      data: { licenceCountryCodes: settings.licenceCountryCodes },
    });
    await page.request.delete(`${API}/influencers/${creator.id}`);
    // Campaigns can't be deleted; a cancelled one stays out of the active lists.
    await page.request.patch(`${API}/campaigns/${campaign.id}`, { data: { status: 'CANCELLED' } });
  }
});
