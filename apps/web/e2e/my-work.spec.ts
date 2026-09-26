import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P3.6 — My work and Approvals: a draft on a campaign I own shows under
 * "Drafts to review" and a deliverable due tomorrow under "Due in the next
 * 3 days"; on a phone the Approvals list opens the review as a bottom sheet
 * and approving it clears it from the list. The sidebar counts both.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const API = '/api/bff/api/v1';
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('My work and Approvals: what I own, reviewed from a phone', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const stamp = Date.now();
  const meRes = (await (await page.request.get(`${API}/auth/me`)).json()) as {
    id?: string;
    user?: { id: string };
  };
  const myId = meRes.user?.id ?? meRes.id!;
  const brands = (await (await page.request.get(`${API}/brands`)).json()) as { id: string }[];
  const brandId = brands[0]!.id;
  const campaign = (await (
    await page.request.post(`${API}/campaigns`, {
      data: { brandId, name: `E2E Mine ${stamp}`, status: 'ACTIVE', ownerId: myId },
    })
  ).json()) as { id: string };
  const creatorName = `E2E Worker ${stamp}`;
  const creator = (await (
    await page.request.post(`${API}/influencers`, {
      data: { displayName: creatorName, countryCode: 'KW' },
    })
  ).json()) as { id: string };
  await page.request.post(`${API}/brand-influencers`, {
    data: { brandId, influencerId: creator.id },
  });
  const row = (await (
    await page.request.post(`${API}/campaigns/${campaign.id}/influencers`, {
      data: {
        campaignId: campaign.id,
        influencerId: creator.id,
        dealType: 'PAID',
        participationStatus: 'CONFIRMED',
      },
    })
  ).json()) as { id: string };
  const deliverable = async (type: string, dueDate?: string) =>
    (
      (await (
        await page.request.post(`${API}/campaign-influencers/${row.id}/deliverables`, {
          data: { campaignInfluencerId: row.id, platform: 'INSTAGRAM', type, dueDate },
        })
      ).json()) as { id: string }
    ).id;
  const reel = await deliverable('REEL');
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  await deliverable('POST', tomorrow);
  const draft = await page.request.post(`${API}/deliverables/${reel}/submissions`, {
    data: { assetUrl: `https://drive.example.com/${stamp}`, caption: `Morning glow ${stamp}` },
  });
  expect(draft.status()).toBe(201);

  try {
    // Desktop: the sidebar counts what's waiting.
    await page.goto('/my-work');
    await expect(page.getByRole('link', { name: /^My work\s*(\d+|99\+)$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Approvals\s*(\d+|99\+)$/ })).toBeVisible();

    // On a phone.
    const ctx = await browser.newContext({
      baseURL,
      userAgent: PHONE_UA,
      viewport: { width: 390, height: 844 },
      storageState: await page.context().storageState(),
    });
    const phone = await ctx.newPage();
    await phone.goto('/my-work');
    const drafts = phone.getByRole('region', { name: /Drafts to review/ });
    await expect(drafts.getByRole('link').filter({ hasText: creatorName })).toContainText('Reel');
    const dueSoon = phone.getByRole('region', { name: /Due in the next 3 days/ });
    await expect(dueSoon.getByRole('link').filter({ hasText: creatorName })).toContainText('Post');
    await noSideScroll(phone);

    await phone.goto('/approvals');
    await phone.getByRole('button', { name: 'Mine', exact: true }).click();
    const card = phone.getByRole('listitem').filter({ hasText: creatorName });
    await expect(card).toContainText(`Morning glow ${stamp}`);
    await noSideScroll(phone);
    await card.getByRole('button', { name: 'Review' }).click();
    const dialog = phone.getByRole('dialog', { name: 'Review submission' });
    await expect(dialog).toBeVisible();
    // A bottom sheet: full width, flush with the bottom of the screen.
    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!;
        return [Math.round(box.width), Math.round(box.y + box.height)];
      })
      .toEqual([390, 844]);
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(phone.getByText('Approved — cleared to post.')).toBeVisible();
    await expect(card).toHaveCount(0);
    await ctx.close();
  } finally {
    await page.request.delete(`${API}/influencers/${creator.id}`);
    await page.request.patch(`${API}/campaigns/${campaign.id}`, { data: { status: 'CANCELLED' } });
  }
});
