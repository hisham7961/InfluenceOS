import { expect, test } from '@playwright/test';

const ADMIN = { email: 'info@influence-op.com', password: 'Password123!' };

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
}

test.describe('InfluenceOS smoke', () => {
  test('unauthenticated users are redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    // Use the heading role to target the app name precisely rather than any
    // other on-page text (e.g. the demo-credential hint).
    await expect(page.getByRole('heading', { name: 'InfluenceOS' })).toBeVisible();
  });

  test('admin can sign in and see Mission Control', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
    await expect(page.getByText('Active Campaigns').first()).toBeVisible();
  });

  test('the live content wall loads', async ({ page }) => {
    await signIn(page);
    await page.goto('/content');
    await expect(page.getByRole('heading', { name: 'Live Content' })).toBeVisible();
  });

  test('the influencer directory renders and switches views', async ({ page }) => {
    await signIn(page);
    await page.goto('/influencers');
    await expect(page.getByRole('heading', { name: 'Influencers' })).toBeVisible();
    // The directory view toggle (Cards / List / Table) is interactive.
    await page.getByRole('tab', { name: 'Table' }).click();
    await expect(page.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
  });

  test('the calendar loads and exposes month/week/agenda views', async ({ page }) => {
    await signIn(page);
    await page.goto('/calendar');
    await expect(page.getByRole('tab', { name: 'Week' })).toBeVisible();
    await page.getByRole('tab', { name: 'Week' }).click();
    await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('data-state', 'active');
  });
});
