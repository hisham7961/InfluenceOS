import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * A Story's screenshot is uploaded from the creator's page and shown on it.
 * The browser sends the file to the app and gets it back from the app — on
 * the CI stack with private MinIO (e2e-s3) the store isn't reachable from the
 * browser at all, as in production, where uploads used to fail with
 * "Upload failed — network error.". A video player's byte-range request
 * comes back as 206 through the same link.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const API = '/api/bff/api/v1';
// A real 1×1 PNG, so the browser can decode and draw it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

test('Story screenshot: uploaded through the app and shown on the creator’s page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const name = `E2E Story ${Date.now()}`;
  const creator = (await (
    await page.request.post(`${API}/influencers`, {
      data: { displayName: name, countryCode: 'KW' },
    })
  ).json()) as { id: string };

  await page.goto(`/influencers/${creator.id}`);
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.getByRole('button', { name: 'Add content' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Story' }).click();
  await dialog.getByRole('combobox').filter({ hasText: 'Platform' }).click();
  await page.getByRole('option', { name: 'Instagram' }).click();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'story.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByText('story.png')).toBeVisible();

  // Every file request stays on the app's own address.
  const elsewhere: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'PUT' && url.origin !== new URL(page.url()).origin)
      elsewhere.push(req.url());
  });
  await dialog.getByRole('button', { name: 'Add Story' }).click();
  await expect(page.getByText('Content added to the live wall.')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(elsewhere).toEqual([]);

  // The Story's picture loads from the app on the creator's page.
  const img = page.locator('img[src*="/api/bff/api/v1/files/"]').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() =>
      img.evaluate(
        (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth,
      ),
    )
    .toBeGreaterThan(0);

  // A byte range through the same link (what a video player asks for).
  const src = (await img.getAttribute('src'))!;
  const part = await page.request.get(src, { headers: { range: 'bytes=0-7' } });
  expect(part.status()).toBe(206);
  expect(part.headers()['content-range']).toBe(`bytes 0-7/${PNG.length}`);
  expect((await part.body()).equals(PNG.subarray(0, 8))).toBe(true);
});
