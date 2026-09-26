import { expect, test, type Page } from '@playwright/test';

/**
 * P3.5 — caption check: the creator sees, while writing the caption on
 * their task link, which hashtags/mentions are still missing and whether it
 * says it's an ad; the team sees the same check when reviewing the draft.
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

test('Caption check: live on the creator page, and on the team’s draft review', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const stamp = Date.now();
  const brands = (await (await page.request.get(`${API}/brands`)).json()) as { id: string }[];
  const brandId = brands[0]!.id;
  const campaign = (await (
    await page.request.post(`${API}/campaigns`, {
      data: { brandId, name: `E2E Caption ${stamp}`, status: 'ACTIVE', draftReview: true },
    })
  ).json()) as { id: string };
  const creator = (await (
    await page.request.post(`${API}/influencers`, {
      data: { displayName: `E2E Captioner ${stamp}`, countryCode: 'KW' },
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
  await page.request.post(`${API}/campaign-influencers/${row.id}/deliverables`, {
    data: {
      campaignInfluencerId: row.id,
      platform: 'INSTAGRAM',
      type: 'REEL',
      requiredHashtags: ['GlowUp'],
      requiredMentions: ['glowkw'],
    },
  });
  const link = (await (
    await page.request.post(`${API}/campaign-influencers/${row.id}/creator-links`, {
      data: { locale: 'en' },
    })
  ).json()) as { path: string };

  try {
    // The creator writes the caption on their phone.
    const ctx = await browser.newContext({
      baseURL,
      userAgent: PHONE_UA,
      viewport: { width: 390, height: 844 },
    });
    const phone = await ctx.newPage();
    await phone.goto(link.path);
    const caption = phone.getByLabel("Caption you'll post (optional)");
    const check = phone.getByRole('group', { name: 'Caption check' });
    await caption.fill('Morning routine #glowup');
    await expect(check.getByText(/Doesn't say it's an ad — add\s+#إعلان \/ #ad/)).toBeVisible();
    await expect(check.getByText("Something's missing")).toBeVisible();
    await expect(check.getByRole('listitem').filter({ hasText: '@glowkw' })).toContainText(
      'missing',
    );
    await expect(check.getByRole('listitem').filter({ hasText: '#GlowUp' })).toContainText(
      'included',
    );
    await caption.fill('Morning routine #glowup with @glowkw #إعلان');
    await expect(check.getByText("Says it's an ad")).toBeVisible();
    await expect(check.getByText("Everything's there")).toBeVisible();
    const overflow = await phone.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await caption.fill('Morning routine #glowup #ad');
    await phone.getByLabel('Link to your draft').fill(`https://drive.example.com/${stamp}`);
    await phone.getByRole('button', { name: 'Send draft' }).click();
    await expect(phone.getByText("Draft sent. We'll review it soon.")).toBeVisible();
    await ctx.close();

    // The team reviews it and sees what's missing.
    await page.goto(`/campaigns/${campaign.id}?tab=submissions`);
    // Let the page hydrate first: a click that lands mid-hydration can be lost.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Review' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Review submission' });
    const teamCheck = dialog.getByRole('group', { name: 'Caption check' });
    await expect(teamCheck.getByText("Says it's an ad")).toBeVisible();
    await expect(teamCheck.getByText("Something's missing")).toBeVisible();
    await expect(teamCheck.getByRole('listitem').filter({ hasText: '@glowkw' })).toContainText(
      'missing',
    );
  } finally {
    await page.request.delete(`${API}/influencers/${creator.id}`);
    await page.request.patch(`${API}/campaigns/${campaign.id}`, { data: { status: 'CANCELLED' } });
  }
});
