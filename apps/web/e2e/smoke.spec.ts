import { expect, test } from '@playwright/test';

const ADMIN = { email: 'admin@influenceos.app', password: 'Password123!' };

test.describe('InfluenceOS smoke', () => {
  test('unauthenticated users are redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('InfluenceOS')).toBeVisible();
  });

  test('admin can sign in and see Mission Control', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
    await page.getByPlaceholder('••••••••').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
    // Pulse stat cards render.
    await expect(page.getByText('Active Campaigns').first()).toBeVisible();
  });

  test('the live content wall loads', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
    await page.getByPlaceholder('••••••••').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/$/);

    await page.goto('/content');
    await expect(page.getByRole('heading', { name: 'Live Content' })).toBeVisible();
  });
});
