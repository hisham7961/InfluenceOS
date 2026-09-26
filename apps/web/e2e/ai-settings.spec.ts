import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P3.2 — AI assistance is off until an admin turns it on in Settings → AI
 * with a Claude API key and a model; the key is never shown again (only its
 * last four characters). Once on, "Enter metrics" offers to read an attached
 * insights screenshot. No request is sent to Claude here — the reading itself
 * is covered by the API tests with a fake client.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const V = '/api/bff/api/v1';
const KEY = 'sk-ant-e2e-browser-test-key-abcd';
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a45d0000000049454e44ae426082',
  'hex',
);

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  await setLocale(page, 'en');
}

async function setLocale(page: Page, locale: 'en' | 'ar') {
  await page.request.patch(`${V}/auth/me/preferences`, { data: { locale } });
  await page.evaluate((l) => {
    document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
  }, locale);
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${V}${url}`, { data });
  expect(res.ok(), `${url} → ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function aiOff(page: Page) {
  await page.request.patch(`${V}/platform/ai`, {
    data: { enabled: false, apiKey: null, model: null },
  });
}

test('AI settings: off by default, turned on with a key and model, then offered in Enter metrics', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await aiOff(page);
  const tag = `AI E2E ${Date.now()}`;
  const brand = await post<{ id: string }>(page, '/brands', { name: `${tag} Brand` });
  const creator = await post<{ id: string }>(page, '/influencers', {
    displayName: `${tag} Creator`,
    countryCode: 'KW',
  });
  const story = await post<{ id: string }>(page, '/content/story', {
    platform: 'SNAPCHAT',
    brandId: brand.id,
    influencerId: creator.id,
    publishedAt: new Date().toISOString().slice(0, 10),
  });

  try {
    // Off: the metrics form has no AI button.
    await page.goto(`/content/${story.id}`);
    await page.getByRole('button', { name: 'Enter metrics' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText("Enter this post's numbers")).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Read the numbers with AI' })).toHaveCount(0);
    await expect(dialog.getByText(/AI can read the numbers/)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Settings → AI.
    await page.goto('/settings');
    await page.getByRole('link', { name: /AI assistance/ }).click();
    await page.waitForURL(/\/settings\/ai$/);
    await expect(page.getByText('Off', { exact: true })).toBeVisible();
    await expect(page.getByText('No key yet.')).toBeVisible();

    // Can't turn on without a key and a model.
    await page.getByRole('switch', { name: 'Turn on AI assistance' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Add a Claude API key and a model ID before turning AI on.'),
    ).toBeVisible();

    await page.getByLabel('Claude API key').fill(KEY);
    await page.getByLabel('Model ID').fill('e2e-test-model');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('AI settings saved')).toBeVisible();
    await expect(page.getByText('On', { exact: true })).toBeVisible();
    await expect(page.getByText('A key ending in abcd is saved.')).toBeVisible();
    await expect(page.getByLabel('Claude API key')).toHaveValue('');
    await expect(page.locator('body')).not.toContainText(KEY);
    // The key never comes back from the API either.
    const settings = await (await page.request.get(`${V}/platform/ai`)).text();
    expect(settings).not.toContain(KEY);

    // On: Enter metrics asks for a screenshot, then offers to read it.
    await page.goto(`/content/${story.id}`);
    await page.getByRole('button', { name: 'Enter metrics' }).click();
    dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(/Attach an insights screenshot above and AI can read the numbers/),
    ).toBeVisible();
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: 'insights.png', mimeType: 'image/png', buffer: PNG });
    await expect(dialog.getByRole('button', { name: 'Read the numbers with AI' })).toBeVisible();

    // Arabic, on a phone.
    await setLocale(page, 'ar');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/ai');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { name: 'مساعدة الذكاء الاصطناعي' }).first(),
    ).toBeVisible();
    await expect(page.getByText('مفعّلة', { exact: true })).toBeVisible();
    await expect(page.getByText('تم حفظ مفتاح ينتهي بـ abcd.')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await setLocale(page, 'en');
    await aiOff(page);
    await page.request.delete(`${V}/content/${story.id}`);
    await page.request.delete(`${V}/influencers/${creator.id}`);
  }
});

test('AI writing help: the buttons show only while writing help is on', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.request.patch(`${V}/platform/ai`, {
    data: { enabled: true, apiKey: KEY, model: 'e2e-test-model', writingHelp: true },
  });
  const tag = `AI W E2E ${Date.now()}`;
  const brand = await post<{ id: string }>(page, '/brands', { name: `${tag} Brand` });
  const campaign = await post<{ id: string }>(page, '/campaigns', {
    brandId: brand.id,
    name: `${tag} Campaign`,
  });

  try {
    // A new script offers an AI first draft, in either language.
    await page.goto(`/campaigns/${campaign.id}?tab=scripts`);
    await page.getByRole('button', { name: 'New script' }).first().click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Draft with AI')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Write the draft' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Language of the draft' })).toBeVisible();
    await expect(dialog.getByText('Caption suggestion')).toBeVisible();
    await page.keyboard.press('Escape');

    // The client report summary can be written with AI.
    await page.getByRole('button', { name: 'Edit campaign' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit campaign' });
    await expect(dialog.getByText('Summary for the client')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Write with AI' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Writing help off: no buttons.
    await page.request.patch(`${V}/platform/ai`, { data: { writingHelp: false } });
    await page.goto(`/campaigns/${campaign.id}?tab=scripts`);
    await page.getByRole('button', { name: 'New script' }).first().click();
    await expect(page.getByRole('dialog').getByText('Caption suggestion')).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Write the draft' }),
    ).toHaveCount(0);
  } finally {
    await page.request.patch(`${V}/platform/ai`, { data: { writingHelp: true } });
    await aiOff(page);
  }
});
