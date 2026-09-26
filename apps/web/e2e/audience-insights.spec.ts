import { expect, test, type Page } from '@playwright/test';

/**
 * P3.7 — audience insights: typed on the creator's page from their insights
 * screenshot, shown as bars, then used by the directory's "More filters"
 * (audience in Kuwait ≥ 50% finds them; ≥ 60% doesn't).
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

test('Audience insights: recorded on the creator, used by the directory filters', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const stamp = Date.now();
  const name = `Aud Creator ${stamp}`;
  const creator = (await (
    await page.request.post(`${API}/influencers`, {
      data: { displayName: name, countryCode: 'KW', languages: ['Arabic'] },
    })
  ).json()) as { id: string };
  const account = await page.request.post(`${API}/influencers/${creator.id}/social-accounts`, {
    data: { influencerId: creator.id, platform: 'INSTAGRAM', username: `aud_${stamp}` },
  });
  expect(account.ok()).toBe(true);

  try {
    await page.goto(`/influencers/${creator.id}`);
    const card = page.locator('#audience');
    await expect(card.getByText('No audience insights yet.', { exact: false })).toBeVisible();
    await card.getByRole('button', { name: 'Add insights' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add audience insights' });
    await dialog.getByLabel('Share (%) 1').fill('55');
    await dialog.getByRole('button', { name: 'Add a country' }).click();
    await dialog.getByLabel('Share (%) 2').fill('20');
    await dialog.getByLabel('Women (%)', { exact: true }).fill('60');
    await dialog.getByLabel('Men (%)', { exact: true }).fill('40');
    await dialog.getByLabel('Age groups (%) 18–24').fill('50');
    await dialog.getByLabel('Engagement rate (%)').fill('3.5');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Audience insights saved.')).toBeVisible();

    const section = card.getByRole('region', { name: `@aud_${stamp}` });
    await expect(section.getByRole('listitem').filter({ hasText: 'Kuwait' })).toContainText('55%');
    await expect(section.getByRole('listitem').filter({ hasText: 'Saudi Arabia' })).toContainText(
      '20%',
    );
    await expect(section.getByRole('listitem').filter({ hasText: /^Women/ })).toContainText('60%');
    await expect(section).toContainText('Engagement 3.5%');

    // Shares over 100% are stopped before they are sent.
    await card.getByRole('button', { name: 'Add insights' }).click();
    const again = page.getByRole('dialog', { name: 'Add audience insights' });
    await again.getByLabel('Share (%) 1').fill('90');
    await again.getByRole('button', { name: 'Add a country' }).click();
    await again.getByLabel('Share (%) 2').fill('30');
    await again.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('The country shares add up to more than 100%.')).toBeVisible();
    await again.getByRole('button', { name: 'Cancel' }).click();

    // The directory: "More filters" → audience in Kuwait.
    await page.goto(`/influencers?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(name).first()).toBeVisible();
    await page.getByRole('button', { name: 'More filters' }).click();
    await page.getByRole('combobox', { name: 'Audience country' }).click();
    await page.getByRole('option', { name: 'Kuwait' }).click();
    await expect(page).toHaveURL(/audienceCountry=KW/);
    await expect(page.getByText('Audience in Kuwait ≥ 40%')).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
    await page.goto(
      `/influencers?q=${encodeURIComponent(name)}&audienceCountry=KW&audienceMinPct=60`,
    );
    await expect(page.getByText('No influencers match your filters')).toBeVisible();
    await page.goto(`/influencers?q=${encodeURIComponent(name)}&language=ar&minEngagementRate=3`);
    await expect(page.getByText('Speaks Arabic')).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
  } finally {
    await page.request.delete(`${API}/influencers/${creator.id}`);
  }
});
