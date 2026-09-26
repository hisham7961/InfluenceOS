import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * P3.3 — a creator's task link: made from the roster row, opened by the
 * creator on a phone without an account (Arabic, right to left, no app
 * menus), a draft sent, reviewed by the team with feedback the creator then
 * sees, the live post link sent and picked up on the deliverable.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

type Row = { id: string; participationStatus: string; influencer: { displayName: string } };

/** A campaign roster row the creator is still on, with a fresh deliverable of our own to work on. */
async function rosterRow(page: Page, stamp: string) {
  const list = (await (await page.request.get('/api/bff/api/v1/campaigns?pageSize=50')).json()) as {
    data: { id: string; status: string }[];
  };
  for (const c of list.data.filter((x) => x.status !== 'CANCELLED')) {
    const roster = (await (
      await page.request.get(`/api/bff/api/v1/campaigns/${c.id}/influencers`)
    ).json()) as Row[];
    const row = roster.find(
      (r) => r.participationStatus !== 'DECLINED' && r.participationStatus !== 'DROPPED',
    );
    if (!row) continue;
    const res = await page.request.post(
      `/api/bff/api/v1/campaign-influencers/${row.id}/deliverables`,
      {
        data: {
          platform: 'INSTAGRAM',
          type: 'REEL',
          requirements: `E2E task ${stamp}`,
          dueDate: '2030-01-15',
        },
      },
    );
    expect(res.ok()).toBeTruthy();
    const deliverable = (await res.json()) as { id: string };
    return {
      campaignId: c.id,
      rowId: row.id,
      name: row.influencer.displayName,
      deliverableId: deliverable.id,
    };
  }
  throw new Error('No campaign with a roster in the seed data');
}

test('Creator task link: made from the roster, used by the creator on a phone, draft reviewed, post link picked up', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  await signIn(page);
  const stamp = Date.now().toString(36);
  const { campaignId, name, deliverableId } = await rosterRow(page, stamp);

  // The team makes the link from the roster row.
  await page.goto(`/campaigns/${campaignId}?tab=influencers`);
  await page
    .getByRole('button', { name: `Task link for ${name}` })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Task link for ${name}` })).toBeVisible();
  // An earlier run may have left a link: start clean.
  await expect(dialog.getByRole('button', { name: /^(Turn off|Create task link)$/ })).toBeVisible();
  if (await dialog.getByRole('button', { name: 'Turn off' }).isVisible()) {
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await page
      .getByRole('dialog', { name: 'Turn off this task link?' })
      .getByRole('button', { name: 'Turn off' })
      .click();
    await expect(page.getByText('Task link turned off')).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Create task link' }).click();
  await expect(page.getByText('Task link ready')).toBeVisible();
  const url = await dialog.getByRole('textbox', { name: 'Task link' }).inputValue();
  expect(url).toMatch(/\/share\/c\/[A-Za-z0-9_-]{43}$/);
  await expect(dialog.getByRole('button', { name: 'Send brief' })).toBeVisible();
  const path = new URL(url).pathname;

  // The creator opens it on a phone, without an account, in Arabic.
  const creatorCtx = await browser.newContext({
    baseURL,
    userAgent: PHONE_UA,
    viewport: { width: 390, height: 844 },
  });
  const phone = await creatorCtx.newPage();
  expect((await phone.goto(path))?.status()).toBe(200);
  await expect(phone).toHaveURL(new RegExp(`${path}$`));
  await expect(phone.locator('main')).toHaveAttribute('dir', 'rtl');
  await expect(phone.getByText(`مرحباً ${name}`)).toBeVisible();
  await expect(phone.getByRole('navigation')).toHaveCount(0);
  const task = phone.locator('article').filter({ hasText: `E2E task ${stamp}` });
  await expect(task).toBeVisible();
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Sends a draft (the campaign may not use draft review, so send it the way the page offers, or via the API).
  const draftLink = task.getByLabel('رابط المسودة');
  if (await draftLink.isVisible()) {
    await draftLink.fill(`https://drive.example.com/${stamp}`);
    await task.getByRole('button', { name: 'إرسال المسودة' }).click();
    await expect(phone.getByText('تم إرسال المسودة. سنراجعها قريباً.')).toBeVisible();
  } else {
    const res = await phone.request.post(
      `/api/bff/api/v1/public/creator/${path.split('/').pop()}/deliverables/${deliverableId}/drafts`,
      {
        data: { assetUrl: `https://drive.example.com/${stamp}` },
      },
    );
    expect(res.ok()).toBeTruthy();
    await phone.reload();
  }
  await expect(task.getByText('نراجع مسودتك الآن. ستظهر ملاحظاتنا هنا.')).toBeVisible();

  // The team sees it as sent by the creator and asks for changes.
  const subs = (await (
    await page.request.get(`/api/bff/api/v1/deliverables/${deliverableId}/submissions`)
  ).json()) as {
    id: string;
    fromCreator: boolean;
  }[];
  expect(subs[0]!.fromCreator).toBe(true);
  await page.goto(`/campaigns/${campaignId}?tab=submissions`);
  await expect(page.getByText('The creator (task link)').first()).toBeVisible();
  const review = await page.request.post(`/api/bff/api/v1/submissions/${subs[0]!.id}/review`, {
    data: { decision: 'REQUEST_CHANGES', note: `More daylight ${stamp}` },
  });
  expect(review.ok()).toBeTruthy();

  // The creator sees the feedback, then sends the live post link.
  await phone.reload();
  await expect(task.getByText(`More daylight ${stamp}`)).toBeVisible();
  await task.getByLabel('رابط منشورك').fill(`https://www.instagram.com/reel/${stamp}/`);
  await task.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(phone.getByText('شكراً! وصلنا الرابط.')).toBeVisible();
  await creatorCtx.close();

  // The team finds it on the deliverable, ready to add.
  await page.goto(`/campaigns/${campaignId}?tab=deliverables`);
  await expect(page.getByText('Creator sent the post').first()).toBeVisible();

  // Tidy up: the test deliverable goes away.
  await page.request.delete(`/api/bff/api/v1/deliverables/${deliverableId}`);
});
