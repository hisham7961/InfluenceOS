import { expect, test, type Page } from '@playwright/test';

/**
 * P3.7 — rate benchmarks: past confirmed bookings of creators on the same
 * platform and follower size show beside the fee when booking (and say
 * whether the fee typed is in the usual range), and on the platform × size
 * page. A currency no other test uses keeps the figures to this test — a
 * different one on a retry, so bookings a failed attempt left behind never
 * count.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const V = '/api/bff/api/v1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN.email);
  await page.getByPlaceholder('••••••••').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/);
  await page.request.patch(`${V}/auth/me/preferences`, { data: { locale: 'en' } });
  await page.evaluate(() => {
    document.cookie = 'locale=en; path=/; max-age=31536000; samesite=lax';
  });
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${V}${url}`, { data });
  expect(res.ok(), `${url} → ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Rate benchmarks: beside the fee when booking, and the platform × size page', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const CUR = ['OMR', 'BHD', 'JOD'][testInfo.retry % 3]!;
  await signIn(page);
  const stamp = Date.now();
  const tag = `Bench E2E ${stamp}`;
  const brand = await post<{ id: string }>(page, '/brands', { name: `${tag} Brand` });
  const campaign = await post<{ id: string }>(page, '/campaigns', {
    brandId: brand.id,
    name: `${tag} Campaign`,
    currency: CUR,
  });
  const creators: string[] = [];
  async function creator(key: string) {
    const c = await post<{ id: string }>(page, '/influencers', {
      displayName: `${tag} ${key}`,
      countryCode: 'OM',
    });
    creators.push(c.id);
    await post(page, `/influencers/${c.id}/social-accounts`, {
      influencerId: c.id,
      platform: 'YOUTUBE',
      username: `bench_${key}_${stamp}`,
      followers: 600_000,
      isPrimary: true,
    });
    return c.id;
  }

  try {
    // Three confirmed macro YouTube bookings: 100, 200 and 300 a post.
    for (const [key, fee] of [
      ['A', 100],
      ['B', 200],
      ['C', 300],
    ] as const) {
      const id = await creator(key);
      await post(page, `/campaigns/${campaign.id}/influencers`, {
        influencerId: id,
        dealType: 'PAID',
        agreedCost: fee,
        participationStatus: 'CONFIRMED',
      });
    }
    await creator('D');

    // Booking a fourth: the usual fee shows beside the fee field.
    await page.goto(`/campaigns/${campaign.id}?tab=influencers`);
    // Let the page hydrate first: a click that lands mid-hydration can be lost.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add influencer' }).first().click();
    const add = page.getByRole('dialog', { name: 'Add influencer to campaign' });
    await add.getByPlaceholder('Search by name or @username…').fill(`${tag} D`);
    await add.getByRole('button', { name: new RegExp(`${tag} D`) }).click();
    const hint = add.getByTestId('fee-benchmark');
    await expect(hint).toContainText(
      `Creators like this (YouTube · Macro (500K–1M)) usually cost ${CUR} 200 a post`,
    );
    await expect(hint).toContainText(`the middle half of 3 bookings paid ${CUR} 150 – ${CUR} 250`);
    await add.getByRole('spinbutton').fill('900');
    await add.getByRole('button', { name: 'Add to campaign' }).click();
    await expect(page.getByText(`${tag} D added to the campaign.`)).toBeVisible();

    // Editing their fee says whether it is in the usual range (they aren't counted against themselves).
    await page.getByRole('button', { name: `Edit ${tag} D` }).click();
    const edit = page.getByRole('dialog', { name: 'Edit influencer' });
    const editHint = edit.getByTestId('fee-benchmark');
    await expect(editHint).toContainText(`${CUR} 900 a post is above the usual range.`);
    await edit.getByRole('spinbutton').first().fill('180');
    await expect(editHint).toContainText(`${CUR} 180 a post is within the usual range.`);
    await edit.getByRole('button', { name: 'Close' }).first().click();

    // The page: the same figures, the selected size highlighted.
    await page.goto(`/reports/benchmarks?currency=${CUR}&platform=YOUTUBE&tier=MACRO`);
    await expect(page.getByRole('heading', { name: 'Rate benchmarks' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'YouTube · Macro (500K–1M)' })).toBeVisible();
    await expect(page.getByTestId('benchmark-feePerPost')).toContainText(`${CUR} 200`);
    await expect(page.getByTestId('benchmark-feePerPost')).toContainText('From 3 bookings');
    const youtube = page.getByRole('region', { name: 'YouTube' });
    const macro = youtube.locator('tr[aria-current="true"]');
    await expect(macro).toContainText('Macro (500K–1M)');
    await expect(macro).toContainText('3');

    // Reachable from Reports.
    await page.goto('/reports');
    await page.getByRole('link', { name: 'Rate benchmarks' }).click();
    await expect(page).toHaveURL(/\/reports\/benchmarks$/);
  } finally {
    // Take the bookings off so they don't count in later runs, then the
    // creators — time-boxed, and never hiding the error that got us here.
    const opts = { timeout: 10_000 };
    try {
      const roster = (await (
        await page.request.get(`${V}/campaigns/${campaign.id}/influencers`, opts)
      ).json()) as { id: string }[];
      for (const r of roster) await page.request.delete(`${V}/campaign-influencers/${r.id}`, opts);
      for (const id of creators) await page.request.delete(`${V}/influencers/${id}`, opts);
    } catch (e) {
      console.warn('rate-benchmarks cleanup failed:', e);
    }
  }
});
