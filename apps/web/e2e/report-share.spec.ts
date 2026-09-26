import { request as playwrightRequest, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P3.3 — the client report shared by link: made from the report page in
 * Arabic, opened by someone who isn't signed in (on a phone, right to left,
 * no app menus, no sideways scroll), downloaded as Excel, counted as a
 * visit, then turned off so the link stops working.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

test('Client report link: made in Arabic, opened without signing in, downloaded, turned off', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  await signIn(page);
  const list = await page.request.get('/api/bff/api/v1/campaigns?pageSize=1');
  const campaign = ((await list.json()) as { data: { id: string; name: string }[] }).data[0]!;

  await page.goto(`/campaigns/${campaign.id}/report?lang=en`);
  await page.getByRole('button', { name: 'Share link' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Share this report by link')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Report language' }).click();
  await page.getByRole('option', { name: 'العربية' }).click();
  await expect(dialog.getByRole('switch', { name: 'Show costs' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect(page.getByText(/^Link created/)).toBeVisible();
  const url = await dialog.getByRole('textbox', { name: 'New link' }).inputValue();
  expect(url).toMatch(/\/share\/r\/[A-Za-z0-9_-]{43}$/);
  const path = new URL(url).pathname;

  // Someone without an account opens it on a phone.
  const visitor = await browser.newContext({
    baseURL,
    userAgent: PHONE_UA,
    viewport: { width: 390, height: 844 },
  });
  const phone = await visitor.newPage();
  const res = await phone.goto(path);
  expect(res?.status()).toBe(200);
  await expect(phone).toHaveURL(new RegExp(`${path}$`)); // not sent to sign in
  const article = phone.locator('article');
  await expect(article).toHaveAttribute('dir', 'rtl');
  await expect(article.getByText('تقرير الحملة')).toBeVisible();
  await expect(phone.getByRole('button', { name: 'طباعة / حفظ PDF' })).toBeVisible();
  await expect(phone.getByRole('navigation')).toHaveCount(0);
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const xlsx = await phone.request.get(`${path}/excel`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  expect(xlsx.headers()['content-disposition']).toMatch(/-report-ar\.xlsx"/);

  // The visit shows in the list; then the link is turned off.
  await page.reload();
  await page.getByRole('button', { name: 'Share link' }).click();
  const row = page
    .getByRole('dialog')
    .getByRole('listitem')
    .filter({ hasText: 'Opened once' })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Turn off' }).click();
  await page
    .getByRole('dialog', { name: 'Turn off this link?' })
    .getByRole('button', { name: 'Turn off' })
    .click();
  await expect(page.getByText('Link turned off')).toBeVisible();

  const gone = await phone.goto(path);
  expect(gone?.status()).toBe(404);
  await expect(phone.getByText('This report link no longer works.')).toBeVisible();
  await expect(phone.getByText('رابط هذا التقرير لم يعد يعمل.')).toBeVisible();
  await visitor.close();

  // A made-up link is simply not found.
  const anonymous = await playwrightRequest.newContext({ baseURL });
  expect((await anonymous.get(`/share/r/${'x'.repeat(43)}`)).status()).toBe(404);
  await anonymous.dispose();
});
