import { expect, test, type Page } from '@playwright/test';

/**
 * P2.8 — list controls and the campaign workspace:
 * - a filter that only arrives by link shows as a chip and can be removed;
 *   the sort menu changes the order and keeps the filters; paging keeps both;
 * - the campaign page's six areas, their views, and links to a view.
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

test('Creator directory: link-only filters as chips, sort, paging keeps both', async ({ page }) => {
  await signIn(page);
  await page.goto('/influencers?missingPhone=true&sort=name&order=asc');
  await page.waitForLoadState('networkidle');

  const chips = page.getByLabel('Active filters');
  await expect(chips.getByText('No phone number')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort: Name A–Z' })).toBeVisible();

  // Sort: newest first is the default, so it leaves the address; the filter stays.
  await page.getByRole('button', { name: /Sort:/ }).click();
  await page.getByRole('menuitem', { name: 'Name Z–A' }).click();
  await expect(page).toHaveURL(/sort=name&order=desc/);
  await expect(page).toHaveURL(/missingPhone=true/);

  // Paging keeps the filter and the sort.
  const next = page.getByRole('link', { name: /go to page 2/i });
  if (await next.count()) {
    await next.first().click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/missingPhone=true/);
    await expect(page).toHaveURL(/order=desc/);
  }

  // Removing the chip removes just that filter (and goes back to page 1).
  await page.getByRole('button', { name: 'Remove filter: No phone number' }).click();
  await expect(page).not.toHaveURL(/missingPhone/);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page).toHaveURL(/order=desc/);
});

test('Campaign workspace: six areas, their views, and links to a view', async ({ page }) => {
  await signIn(page);
  const list = await page.request.get('/api/bff/api/v1/campaigns?pageSize=1');
  const campaign = ((await list.json()) as { data: { id: string }[] }).data[0]!;

  await page.goto(`/campaigns/${campaign.id}`);
  for (const area of ['Overview', 'Roster', 'Content', 'Approvals', 'Logistics & budget', 'Collaboration']) {
    await expect(page.getByRole('tab', { name: area, exact: true }).first()).toBeVisible();
  }

  // An area opens its first view; the view is in the address.
  await page.getByRole('tab', { name: 'Roster', exact: true }).click();
  await expect(page).toHaveURL(/tab=influencers/);
  await page.getByRole('tab', { name: 'Operations Board' }).click();
  await expect(page).toHaveURL(/tab=operations/);

  // Another area, then back: the area remembers the view you left it on.
  await page.getByRole('tab', { name: 'Approvals', exact: true }).click();
  await expect(page).toHaveURL(/tab=submissions/);
  await page.getByRole('tab', { name: 'Roster', exact: true }).click();
  await expect(page).toHaveURL(/tab=operations/);
  await expect(page.getByRole('tab', { name: 'Operations Board' })).toHaveAttribute('data-state', 'active');

  // A link to a view opens its area with that view, and survives a reload.
  await page.goto(`/campaigns/${campaign.id}?tab=deliverables`);
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tab', { name: 'Deliverables' })).toHaveAttribute('data-state', 'active');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Deliverables' })).toHaveAttribute('data-state', 'active');
});
