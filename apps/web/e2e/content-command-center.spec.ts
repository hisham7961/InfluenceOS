import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Content Command Center pass — browser verification of the per-user
 * New/Seen/Reviewed/Review Later state, the default Timeline view (day →
 * brand grouping), Review Mode, Mission Control's "Since Your Last Visit",
 * and RTL/mobile smoke checks. The API integration suite already proves the
 * per-user isolation and aggregation contracts against a real database; this
 * drives the same concepts through the rendered UI.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const STAMP = Date.now();
const BRAND = `CC Brand ${STAMP}`;
const CAMPAIGN = `CC Campaign ${STAMP}`;
const videoId = (n: number) => (STAMP.toString(36) + n.toString(36) + 'zzzzzzzzzzz').slice(0, 11);

test.describe.configure({ mode: 'serial' });

/**
 * This account is shared by several specs, and its saved language follows it
 * into every sign-in. Put it back to English (account and cookie) so one run
 * that stopped halfway through the Arabic test can't turn every later test
 * Arabic.
 */
async function useEnglish(page: Page) {
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
    await useEnglish(page);
    await page.reload();
  }
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
}

async function openQuickAdd(page: Page, item: string) {
  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('Content Command Center: per-user review state, Timeline grouping, Review Mode, Mission Control', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  // --- Setup: brand + campaign, then two pieces of content on that campaign ---
  await openQuickAdd(page, 'Brand');
  const brandDialog = page.getByRole('dialog');
  await brandDialog.getByRole('textbox').first().fill(BRAND);
  await brandDialog.getByRole('button', { name: /create brand/i }).click();
  await page.waitForURL(/\/brands\//);
  const brandUrl = page.url();
  await expect(page.getByRole('heading', { name: BRAND })).toBeVisible();

  await openQuickAdd(page, 'Campaign');
  const campDialog = page.getByRole('dialog');
  await campDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: BRAND }).click();
  await campDialog.getByPlaceholder('Summer Glow Launch').fill(CAMPAIGN);
  await campDialog.getByRole('button', { name: /create campaign/i }).click();
  await page.waitForURL(/\/campaigns\//);
  const campaignUrl = page.url();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Content #1 — will be explicitly reviewed.
  await openQuickAdd(page, 'Published content');
  const content1Dialog = page.getByRole('dialog');
  await content1Dialog.getByPlaceholder(/youtube\.com\/watch/i).fill(`https://www.youtube.com/watch?v=${videoId(1)}`);
  await content1Dialog.getByRole('combobox').nth(1).click();
  // The campaign picker searches as you type (it lists the newest first).
  await page.getByPlaceholder('Type a name…').fill(CAMPAIGN);
  await page.getByRole('option', { name: new RegExp(CAMPAIGN) }).click();
  await content1Dialog.getByRole('button', { name: 'Add content' }).click();
  await page.waitForURL(/\/content\//);
  const content1Url = page.url();

  // --- Content detail page: New → Mark Reviewed → Review Later ---
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark Reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Mark Unreviewed' })).toBeVisible();
  await expect(page.getByText('Reviewed', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Review Later' }).click();
  await expect(page.getByRole('button', { name: 'Saved for later' })).toBeVisible();

  // Content #2 — stays New for this user, used for the brand-scoped Review
  // Mode below. Added via the Campaign workspace's own "Add content" flow
  // (which stays in place after submit) rather than Quick Add, which
  // auto-navigates to the content detail page — and that page marks Seen on
  // mount (item 5), which would immediately disqualify it from Review Mode.
  await page.goto(campaignUrl);
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await page.getByRole('tab', { name: 'Live Content' }).click();
  await page.getByRole('button', { name: 'Add content' }).click();
  const content2Dialog = page.getByRole('dialog');
  await content2Dialog.getByPlaceholder(/youtube\.com\/watch/i).fill(`https://www.youtube.com/watch?v=${videoId(2)}`);
  await content2Dialog.getByRole('button', { name: 'Add content' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // --- Timeline (default view) shows day + brand grouping ---
  await page.goto('/content');
  await expect(page.getByRole('heading', { name: 'Live Content' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Timeline layout' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText(/^Today/).first()).toBeVisible();
  await expect(page.getByText(BRAND).first()).toBeVisible();

  // Reviewed filter chip surfaces content #1 (search narrows to our tagged URLs).
  await page.getByPlaceholder('Search caption or creator…').fill(STAMP.toString(36));
  await page.waitForTimeout(500); // debounce
  const reviewedChip = page.getByRole('group', { name: 'Content filters' }).getByRole('button', { name: /^Reviewed/ });
  if (await reviewedChip.count()) {
    await reviewedChip.click();
    await expect(page.getByText(BRAND).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Reset' }).click().catch(() => undefined);

  // --- Brand page: Mission Control is brand-scoped, Review Mode reviews content #2 ---
  await page.goto(brandUrl);
  const reviewButton = page.getByRole('button', { name: /Review \d+ New Videos?/ });
  await expect(reviewButton).toBeVisible();
  await reviewButton.click();
  // This click triggers a real network round trip (api.content.feed) before
  // the Review Mode viewer mounts and this text appears — see
  // playwright.config.ts's CI-only expect timeout for why this needs more
  // margin than local dev under CI's shared, resource-constrained runner.
  await expect(page.getByText(/\d+ of \d+ reviewed/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark Reviewed' }).click();
  await expect(page.getByText(/\d+ of \d+ reviewed/)).toContainText('1 of 1');
  // The button label flips optimistically before the PATCH resolves; wait for
  // it to re-enable (the request has landed) before relying on server state —
  // otherwise the next step's fresh fetch can race the write still in flight.
  await expect(page.getByRole('button', { name: 'Mark Unreviewed' })).toBeEnabled();
  await page.keyboard.press('Escape');

  // Caught up — clicking again with nothing left to review shows the message, not the dialog.
  await page.getByRole('button', { name: /Review \d+ New Videos?/ }).click();
  await expect(page.getByText(/caught up/i)).toBeVisible({ timeout: 10_000 });
});

test('RTL: Timeline and Mission Control render correctly in Arabic', async ({ page }) => {
  test.slow();
  await signIn(page);
  try {
    // Force a known starting locale — the assertions below assume an LTR
    // baseline to toggle away from.
    await useEnglish(page);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    // The toggle is a client button: let the page finish loading (and
    // hydrate) before clicking it, or the click can land on inert markup.
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Toggle language' }).click();
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Full Arabic translation (Localization pass) means the heading itself is
    // now translated, not just the layout direction — "مركز العمليات" is the
    // canonical Arabic for "Mission Control" (messages/ar/dashboard.json).
    await expect(page.getByRole('heading', { name: 'مركز العمليات' })).toBeVisible();

    await page.goto('/content');
    await expect(page.getByRole('heading', { name: 'المحتوى المنشور' })).toBeVisible();

    // Switch back with the toggle too. Its accessible name is translated
    // (correct a11y behavior), so it reads its Arabic label in RTL.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'تبديل اللغة' }).click();
    await page.waitForFunction(() => document.documentElement.dir === 'ltr');
  } finally {
    // Whatever happened above, never leave the shared account in Arabic.
    await useEnglish(page).catch(() => undefined);
  }
});

test('Mobile viewport: Live Content has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/content');
  await expect(page.getByRole('heading', { name: 'Live Content' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
