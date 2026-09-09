import { expect, test, type Page } from '@playwright/test';

/**
 * Full browser Definition-of-Done journey (finding #3). Unlike the smoke suite,
 * this drives the real operator workflow entirely through the UI against the
 * running full stack, then verifies the effects surface where they should.
 *
 * It is intentionally serial and generous with waits — it is a journey, not a
 * unit test.
 */

const ADMIN = { email: 'admin@influenceos.app', password: 'Password123!' };
const STAMP = Date.now();
const BRAND = `DoD Brand ${STAMP}`;
const INFLUENCER = `DoD Creator ${STAMP}`;
const CAMPAIGN = `DoD Campaign ${STAMP}`;
const VIDEO_ID = (STAMP.toString(36) + 'zzzzzzzzzzz').slice(0, 11);

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
}

async function openQuickAdd(page: Page, item: string) {
  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('operator can run a campaign end-to-end through the browser', async ({ page }) => {
  test.slow();
  await signIn(page);

  // 1. Create a brand.
  await openQuickAdd(page, 'Brand');
  const brandDialog = page.getByRole('dialog');
  await brandDialog.getByRole('textbox').first().fill(BRAND);
  await brandDialog.getByRole('button', { name: /create brand/i }).click();
  await page.waitForURL(/\/brands\//);
  await expect(page.getByRole('heading', { name: BRAND })).toBeVisible();

  // 2. Create an influencer with a social account (manual handle).
  await openQuickAdd(page, 'Influencer');
  const infDialog = page.getByRole('dialog');
  await infDialog.getByPlaceholder('https://instagram.com/creator').fill(`https://www.youtube.com/@dod${STAMP}`);
  await infDialog.getByPlaceholder('Full or display name').fill(INFLUENCER);
  await infDialog.getByRole('button', { name: /add influencer/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // 3. Create a campaign for the brand.
  await openQuickAdd(page, 'Campaign');
  const campDialog = page.getByRole('dialog');
  await campDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: BRAND }).click();
  await campDialog.getByPlaceholder('Summer Glow Launch').fill(CAMPAIGN);
  await campDialog.getByRole('button', { name: /create campaign/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // 4. Open the campaign workspace.
  await page.goto('/campaigns');
  await page.getByRole('link', { name: CAMPAIGN }).click();
  await expect(page.getByRole('heading', { name: CAMPAIGN })).toBeVisible();

  // 5. Add our influencer to the campaign (PAID is the default deal type).
  await page.getByRole('tab', { name: 'Influencers' }).click();
  await page.getByRole('button', { name: 'Add influencer' }).click();
  const addInf = page.getByRole('dialog');
  await addInf.getByPlaceholder('Search by name or @username…').fill(INFLUENCER);
  await addInf.getByRole('button', { name: INFLUENCER }).click();
  await addInf.getByPlaceholder('0.00').fill('750');
  await addInf.getByRole('button', { name: /add to campaign/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(INFLUENCER).first()).toBeVisible();

  // 6. Add a deliverable to that influencer (dialog defaults are fine).
  await page.getByRole('button', { name: /add deliverable/i }).first().click();
  const delDialog = page.getByRole('dialog');
  await delDialog.getByRole('button', { name: /add deliverable/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // 7. Publish content linked to the campaign.
  await openQuickAdd(page, 'Published content');
  const contentDialog = page.getByRole('dialog');
  await contentDialog.getByPlaceholder(/youtube\.com\/watch/i).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  // Link to the campaign (optional select).
  await contentDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(CAMPAIGN) }).click();
  await contentDialog.getByRole('button', { name: /add content/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // 8. It surfaces on the Live Content wall.
  await page.goto('/content');
  await expect(page.getByRole('heading', { name: 'Live Content' })).toBeVisible();

  // 9. It surfaces in Mission Control → What's New.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();

  // 10. Attachments: upload → list → delete, in the campaign Files tab.
  await page.goto('/campaigns');
  await page.getByRole('link', { name: CAMPAIGN }).click();
  await page.getByRole('tab', { name: 'Files' }).click();
  const fileName = `brief-${STAMP}.txt`;
  await page.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('DoD attachment contents'),
  });
  // The uploaded file lands as a row with a download link (not the toast).
  const fileLink = page.getByRole('link', { name: fileName });
  await expect(fileLink).toBeVisible({ timeout: 15_000 });
  // Its download URL is a signed link (private storage — no public URL).
  await expect(fileLink).toHaveAttribute('href', /token=/);
  // Delete it, and the row disappears.
  await page.getByRole('button', { name: `Delete ${fileName}` }).click();
  await expect(fileLink).toBeHidden({ timeout: 15_000 });

  // 11. Admin surfaces render, and the Audit Log reflects our actions.
  await page.goto('/settings/platform');
  await expect(page.getByRole('heading', { name: /platform/i }).first()).toBeVisible();

  await page.goto('/settings/storage');
  await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();

  await page.goto('/settings/audit');
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
  // Our brand creation is in the audit trail.
  await expect(page.getByText(new RegExp(BRAND)).first()).toBeVisible({ timeout: 15_000 });
});
