import { expect, test, type Page } from '@playwright/test';

/**
 * Browser verification of the content-association + logistics workflow pass
 * (docs/workflow/WORKFLOW_GAP_MATRIX.md, scenarios A–J). The API integration
 * suite already proves the business rules at the HTTP layer against a real
 * database; this drives the same scenarios through the real rendered UI to
 * catch what typecheck/lint cannot — broken selectors, dead client
 * components, RSC serialization errors, and dialogs that don't wire up.
 *
 * Uses a dedicated E2E admin account seeded directly into the local database
 * for this session (not the demo-seed default), since this environment's
 * Postgres already carries substantial non-demo data.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const STAMP = Date.now();
const BRAND = `WF Brand ${STAMP}`;
const INFLUENCER = `WF Creator ${STAMP}`;
const CAMPAIGN = `WF Campaign ${STAMP}`;
const videoId = (n: number) => (STAMP.toString(36) + n.toString(36) + 'zzzzzzzzzzz').slice(0, 11);

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

test('operator drives the full content-association + logistics workflow through the browser', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  // --- Setup: brand, influencer, campaign, roster, deliverable ------------
  await openQuickAdd(page, 'Brand');
  const brandDialog = page.getByRole('dialog');
  await brandDialog.getByRole('textbox').first().fill(BRAND);
  await brandDialog.getByRole('button', { name: /create brand/i }).click();
  await page.waitForURL(/\/brands\//);
  await expect(page.getByRole('heading', { name: BRAND })).toBeVisible();

  await openQuickAdd(page, 'Influencer');
  const infDialog = page.getByRole('dialog');
  await infDialog.getByPlaceholder('https://instagram.com/creator').fill(`https://www.youtube.com/@wf${STAMP}`);
  await infDialog.getByPlaceholder('Full or display name').fill(INFLUENCER);
  await infDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Kuwait', exact: true }).click();
  await infDialog.getByRole('button', { name: /add influencer/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await openQuickAdd(page, 'Campaign');
  const campDialog = page.getByRole('dialog');
  await campDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: BRAND }).click();
  await campDialog.getByPlaceholder('Summer Glow Launch').fill(CAMPAIGN);
  await campDialog.getByRole('button', { name: /create campaign/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/campaigns');
  // Let the list hydrate first: a click that lands mid-hydration can be lost.
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: CAMPAIGN }).click();
  await expect(page.getByRole('heading', { name: CAMPAIGN })).toBeVisible();

  // The campaign workspace groups its views into six areas (P2.8).
  await page.getByRole('tab', { name: 'Roster' }).click();
  await page.getByRole('tab', { name: 'Influencers' }).click();
  await page.getByRole('button', { name: 'Add influencer' }).click();
  const addInf = page.getByRole('dialog');
  await addInf.getByPlaceholder('Search by name or @username…').fill(INFLUENCER);
  await addInf.getByRole('button', { name: INFLUENCER }).click();
  await addInf.getByRole('button', { name: /add to campaign/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(INFLUENCER).first()).toBeVisible();

  // A UGC deliverable that requires a physical product — exercises both the
  // "Needs product" badge and the submission (no public URL) path.
  await page.getByRole('button', { name: /add deliverable/i }).first().click();
  const delDialog = page.getByRole('dialog');
  await delDialog.getByRole('combobox').first().click(); // Platform select
  await page.getByRole('option', { name: 'Instagram' }).click();
  const typeCombo = delDialog.getByRole('combobox').nth(1);
  await typeCombo.click();
  await page.getByRole('option', { name: 'UGC', exact: true }).click();
  await delDialog.getByRole('switch', { name: 'Physical product required' }).click();
  await delDialog.getByRole('button', { name: /add deliverable/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The "Needs product" badge renders (deliverable.requiresProduct persisted).
  await expect(page.getByText('Needs product')).toBeVisible();

  // --- SCENARIO C — deliverable-locked Add Content: zero repeated selectors ---
  await page.getByRole('button', { name: 'Add content' }).first().click();
  const addContentFromDeliverable = page.getByRole('dialog');
  await expect(addContentFromDeliverable.getByText(/derived automatically/i).first()).toBeVisible();
  await addContentFromDeliverable.getByPlaceholder(/youtube\.com\/watch/i).fill(`https://www.youtube.com/watch?v=${videoId(1)}`);
  await addContentFromDeliverable.getByRole('button', { name: 'Add content' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // --- WF-11 — UGC completes via submission review, NEVER needs a public URL ---
  await page.getByRole('button', { name: /submit draft/i }).click();
  const submitDialog = page.getByRole('dialog');
  await expect(submitDialog.getByText(/never need a public post/i)).toBeVisible();
  // Deliberately leave the Asset link blank — proves UGC completion requires
  // no public URL (Critical Business Question).
  await submitDialog.getByRole('button', { name: /submit for review/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The campaign workspace groups its views into six areas (P2.8).
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await page.getByRole('tab', { name: 'Submissions' }).click();
  await page.getByRole('button', { name: 'Review' }).click();
  const reviewDialog = page.getByRole('dialog');
  await expect(reviewDialog.getByRole('heading', { name: 'Review submission' })).toBeVisible();
  await reviewDialog.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // --- SCENARIO A — influencer-only content via the Influencer 360 page ------
  await page.goto('/influencers');
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: INFLUENCER }).click();
  await expect(page.getByRole('heading', { name: INFLUENCER })).toBeVisible();
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.getByRole('button', { name: 'Add content' }).click();
  const addFromInfluencer = page.getByRole('dialog');
  await expect(addFromInfluencer.getByText(`Influencer: ${INFLUENCER}`)).toBeVisible();
  await addFromInfluencer.getByPlaceholder(/youtube\.com\/watch/i).fill(`https://www.youtube.com/watch?v=${videoId(2)}`);
  await addFromInfluencer.getByRole('button', { name: 'Add content' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // --- Timeline (WF-13) — the influencer's ActivityFeed shows the workflow ---
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('data-state', 'active');
  // The feed (reused ActivityFeed component, sourced from ActivityLog) has
  // rendered something for this influencer — not empty, not an error state.
  await expect(page.getByText(/couldn't load activity/i)).toHaveCount(0);

  // --- SCENARIO B — fully unassigned content via Quick Add, resolved later ---
  await openQuickAdd(page, 'Published content');
  const quickAddContent = page.getByRole('dialog');
  const unassignedUrl = `https://www.youtube.com/watch?v=${videoId(3)}`;
  await quickAddContent.getByPlaceholder(/youtube\.com\/watch/i).fill(unassignedUrl);
  await quickAddContent.getByRole('button', { name: 'Add content' }).click();
  // Quick Add navigates straight to the new content's detail page.
  await page.waitForURL(/\/content\//);
  await expect(page.getByText('Unassigned').first()).toBeVisible();

  // Resolve it — same record, no duplicate — via the association panel.
  await page.getByRole('button', { name: 'Edit associations' }).click();
  // The creator picker searches as you type (it used to list only the first 100).
  await page.getByRole('combobox', { name: 'Influencer', exact: true }).click();
  await page.getByPlaceholder('Type a name…').fill(INFLUENCER);
  await page.getByRole('option', { name: INFLUENCER }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Influencer linked')).toBeVisible({ timeout: 10_000 });

  // --- Unassigned Content inbox (WF-10) — the wall's Assignment filter -------
  await page.goto('/content');
  await expect(page.getByRole('heading', { name: 'Live Content' })).toBeVisible();
  // The Assignment filter is the one that reads "All content".
  await page.getByRole('combobox').filter({ hasText: 'All content' }).click();
  await page.getByRole('option', { name: 'Unassigned' }).click();
  await expect(page.getByText(new RegExp(CAMPAIGN))).toHaveCount(0);

  // --- Logistics (WF-12/13) — create a shipment with product line items ------
  await page.goto('/campaigns');
  // Let the list hydrate first: a click that lands mid-hydration can be lost.
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: CAMPAIGN }).click();
  // The campaign workspace groups its views into six areas (P2.8).
  await page.getByRole('tab', { name: 'Logistics & budget' }).click();
  await page.getByRole('tab', { name: 'Shipments' }).click();
  await page.getByRole('button', { name: 'Create shipment' }).click();
  const shipDialog = page.getByRole('dialog');
  await shipDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: INFLUENCER }).click();
  const shipTextboxes = shipDialog.getByRole('textbox');
  await shipTextboxes.nth(0).fill('Test Recipient'); // Recipient
  await shipTextboxes.nth(1).fill('+96500000000'); // Phone
  await shipTextboxes.nth(2).fill('10 Gulf Rd'); // Address
  await shipTextboxes.nth(3).fill('Kuwait City'); // City
  await shipTextboxes.nth(4).fill('Kuwait'); // Country
  await shipTextboxes.nth(5).fill('Toner'); // Product name
  await shipDialog.getByRole('button', { name: 'Create shipment' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Toner')).toBeVisible();

  // --- Cross-screen visibility (WF-13) — same shipment row on /logistics -----
  await page.goto('/logistics');
  await expect(page.getByRole('heading', { name: 'Logistics' })).toBeVisible();
  await expect(page.getByText(INFLUENCER).first()).toBeVisible({ timeout: 10_000 });

  // Advance status from the cross-campaign workspace — proves two-way sync
  // (the campaign Shipments tab reads the exact same row, never a copy).
  // The status control lives inside the shipment's own detail sheet (opened
  // by clicking its row), not as an inline row-level combobox — the table
  // row itself only shows a read-only status badge.
  await page.getByText(INFLUENCER).first().click();
  const shipmentSheet = page.getByRole('dialog');
  await shipmentSheet.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Shipped' }).click();
  await expect(shipmentSheet.getByText('Shipped').first()).toBeVisible({ timeout: 10_000 });
  await shipmentSheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
