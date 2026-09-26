import { expect, test, type Page } from '@playwright/test';

/**
 * P3.4 — post discovery in the campaign's content view: the "posts found"
 * panel is there for people who manage content, and "Look for new posts"
 * reports what it could read (no platform keys in this environment, so it
 * says why instead of calling out). Matching, adding and dismissing are
 * covered by the API suite (post-discovery.test.ts) and unit tests.
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

test('Post discovery: the found-posts panel and "look for new posts"', async ({ page }) => {
  await signIn(page);
  const list = (await (await page.request.get('/api/bff/api/v1/campaigns?pageSize=50')).json()) as {
    data: { id: string }[];
  };
  let campaignId: string | null = null;
  for (const c of list.data) {
    const roster = (await (
      await page.request.get(`/api/bff/api/v1/campaigns/${c.id}/influencers`)
    ).json()) as unknown[];
    if (roster.length) {
      campaignId = c.id;
      break;
    }
  }
  expect(campaignId).not.toBeNull();

  await page.goto(`/campaigns/${campaignId}?tab=content`);
  const panel = page.locator('section[aria-labelledby="found-posts-heading"]');
  await expect(panel.getByRole('heading', { name: /found on creators' accounts/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Look for new posts' }).click();
  await expect(
    page
      .getByText(
        /No account could be read|None of this campaign's creators|Checked a few minutes ago|nothing new|Found \d+ new post/,
      )
      .first(),
  ).toBeVisible();
});
