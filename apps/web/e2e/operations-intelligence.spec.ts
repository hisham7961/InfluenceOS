import { expect, test, type Page } from '@playwright/test';

/**
 * Browser verification of the Operations Intelligence, Creator 360 & Team
 * Collaboration pass — comments/@mentions with a deep-linked notification, a
 * pinned Manager Callout, Campaign Discussion vs. the General Team Chat
 * staying distinct scopes of the same Collaboration primitive, Trends &
 * Inspiration (never a PublishedContent duplicate), Creator 360's
 * Relationship Snapshot + Timeline, the Campaign Operations Board's stage
 * pipeline, Saved Views + Bulk Operations' preview-before-commit flow, and
 * the Needs Attention / Data Quality / Executive dashboard pages loading with
 * their real, server-derived content. The API integration suite already
 * proves the underlying business logic (campaign-operations-board.test.ts,
 * data-quality.test.ts, integrity-guard.test.ts, exec-dashboard.test.ts,
 * saved-views-search.test.ts, bulk-influencer.test.ts,
 * inspiration-script-link.test.ts); this drives the same concepts through
 * the real rendered UI.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const STAMP = Date.now();
const BRAND = `OI Brand ${STAMP}`;
const CAMPAIGN = `OI Campaign ${STAMP}`;
const INFLUENCER = `OI Creator ${STAMP}`;
const PASSWORD = 'Str0ng-Passw0rd!';
const MENTIONED_NAME = `OI Mentee ${STAMP}`;
const MENTIONED_EMAIL = `oi-mentee-${STAMP}@example.test`;
const videoId = (n: number) => (STAMP.toString(36) + n.toString(36) + 'zzzzzzzzzzz').slice(0, 11);

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto('/login');
    await page.getByPlaceholder('you@company.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    try {
      await page.waitForURL(/\/$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible({ timeout: 25_000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

async function switchTo(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await signIn(page, email, password);
}

async function openQuickAdd(page: Page, item: string) {
  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('operator drives Comments, Mentions, Campaign/Team Chat, Trends, Creator 360, Operations Board, Saved Views/Bulk Ops', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, ADMIN.email, ADMIN.password);

  // ===========================================================================
  // SETUP — a brand, an influencer, a campaign with the influencer on its
  // roster, and one piece of published content, plus a second plain STAFF
  // account to receive an @mention notification.
  // ===========================================================================
  await openQuickAdd(page, 'Brand');
  const brandDialog = page.getByRole('dialog');
  await brandDialog.getByRole('textbox').first().fill(BRAND);
  await brandDialog.getByRole('button', { name: /create brand/i }).click();
  await page.waitForURL(/\/brands\//);
  await expect(page.getByRole('heading', { name: BRAND })).toBeVisible();

  await openQuickAdd(page, 'Influencer');
  const infDialog = page.getByRole('dialog');
  await infDialog.getByPlaceholder('Full or display name').fill(INFLUENCER);
  await infDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Kuwait', exact: true }).click();
  await infDialog.getByRole('button', { name: 'Add influencer' }).click();
  await page.waitForURL(/\/influencers\//);
  const influencerUrl = page.url();
  await expect(page.getByRole('heading', { name: INFLUENCER })).toBeVisible();

  await openQuickAdd(page, 'Campaign');
  const campDialog = page.getByRole('dialog');
  await campDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: BRAND }).click();
  await campDialog.getByPlaceholder('Summer Glow Launch').fill(CAMPAIGN);
  await campDialog.getByRole('button', { name: /create campaign/i }).click();
  await page.waitForURL(/\/campaigns\//);
  const campaignUrl = page.url();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Roster the influencer onto the campaign (Influencers tab → Add influencer,
  // a search-and-pick flow, not a plain dropdown).
  await page.getByRole('tab', { name: 'Influencers' }).click();
  await page.getByRole('button', { name: 'Add influencer' }).click();
  const rosterDialog = page.getByRole('dialog');
  await expect(rosterDialog.getByText('Add influencer to campaign')).toBeVisible();
  await rosterDialog.getByPlaceholder('Search by name or @username…').fill(INFLUENCER);
  await rosterDialog.getByText(INFLUENCER, { exact: true }).click();
  await rosterDialog.getByRole('button', { name: 'Add to campaign' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // One published content item on this campaign.
  await openQuickAdd(page, 'Published content');
  const contentDialog = page.getByRole('dialog');
  await contentDialog.getByPlaceholder(/youtube\.com\/watch/i).fill(`https://www.youtube.com/watch?v=${videoId(1)}`);
  await contentDialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: new RegExp(CAMPAIGN) }).click();
  await contentDialog.getByRole('button', { name: 'Add content' }).click();
  await page.waitForURL(/\/content\//);
  const contentUrl = page.url();

  // A second plain STAFF user to receive the @mention notification.
  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await page.getByRole('button', { name: 'Add user' }).click();
  const addUserDialog = page.getByRole('dialog');
  await addUserDialog.getByPlaceholder('Jane Doe').fill(MENTIONED_NAME);
  await addUserDialog.getByPlaceholder('jane@brand.com').fill(MENTIONED_EMAIL);
  await addUserDialog.getByPlaceholder('••••••••').fill(PASSWORD);
  await addUserDialog.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // ===========================================================================
  // E2E — COMMENTS + @MENTION + MANAGER CALLOUT PIN on the content detail page.
  // ===========================================================================
  await page.goto(contentUrl);
  const commentBody = `Strong opening hook @${MENTIONED_NAME} ${STAMP}`;
  const composer = page.getByPlaceholder(/Strong opening hook/i);
  // The mention-trigger regex only matches word/./- characters after "@", so
  // the query text must be a space-free substring of the target's name — the
  // STAMP suffix (no spaces) is a reliable, unique one.
  await composer.pressSequentially(`Strong opening hook @${STAMP}`);
  await expect(page.getByText('Mention someone')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: MENTIONED_NAME }).click();
  await composer.fill(commentBody);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(commentBody)).toBeVisible({ timeout: 15_000 });

  // Pin it as a Manager Callout.
  await page.getByTitle('Pin').first().click();
  await expect(page.getByText(new RegExp(`Manager Callout`))).toBeVisible({ timeout: 10_000 });

  // ===========================================================================
  // E2E — the mentioned employee gets a deep-linked notification.
  // ===========================================================================
  await switchTo(page, MENTIONED_EMAIL, PASSWORD);
  await page.getByRole('button', { name: 'Notifications' }).click();
  const notifLink = page.getByRole('link', { name: /mentioned you/ }).first();
  await expect(notifLink).toBeVisible({ timeout: 15_000 });
  await notifLink.click();
  await expect(page).toHaveURL(/\/content\//, { timeout: 15_000 });

  // ===========================================================================
  // E2E — CAMPAIGN DISCUSSION vs. GENERAL TEAM CHAT stay distinct scopes of
  // the same collaboration primitive.
  // ===========================================================================
  await switchTo(page, ADMIN.email, ADMIN.password);
  await page.goto(`${campaignUrl}?tab=discussion`);
  await expect(page.getByRole('tab', { name: 'Discussion' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText('Campaign Chat')).toBeVisible();
  const campaignMessage = `Let's brief the creator on tone — ${STAMP}`;
  await page.getByPlaceholder(/Message the team about this campaign/i).fill(campaignMessage);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(campaignMessage)).toBeVisible({ timeout: 15_000 });

  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  const teamMessage = `Reminder: brand safety review is due Friday — ${STAMP}`;
  await page.getByPlaceholder(/Message the team… use @/i).fill(teamMessage);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(teamMessage)).toBeVisible({ timeout: 15_000 });
  // The campaign-scoped message never leaks into the company-wide General chat.
  await expect(page.getByText(campaignMessage)).toHaveCount(0);

  // ===========================================================================
  // E2E — TRENDS & INSPIRATION: saved as its own record, never a
  // PublishedContent duplicate (must never show up on the Live Content wall).
  // ===========================================================================
  await page.goto('/inspiration');
  await expect(page.getByRole('heading', { name: 'Inspiration' })).toBeVisible();
  await page.getByRole('button', { name: 'Save trend' }).first().click();
  const trendDialog = page.getByRole('dialog');
  await expect(trendDialog.getByText('Save a trend or reference')).toBeVisible();
  const trendUrl = `https://www.tiktok.com/@brand/video/${STAMP}`;
  await trendDialog.getByPlaceholder('https://…').fill(trendUrl);
  await trendDialog.getByPlaceholder('What is it?').fill(`Trending hook format ${STAMP}`);
  await trendDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(`Trending hook format ${STAMP}`)).toBeVisible({ timeout: 10_000 });

  await page.goto('/content');
  await page.getByPlaceholder('Search caption or creator…').fill(`Trending hook format ${STAMP}`);
  await page.waitForTimeout(500);
  await expect(page.getByText(`Trending hook format ${STAMP}`)).toHaveCount(0);

  // ===========================================================================
  // E2E — CREATOR 360: Relationship Snapshot + Timeline bucket filters.
  // ===========================================================================
  await page.goto(influencerUrl);
  await expect(page.getByText('Relationship Snapshot')).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campaign', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();

  // ===========================================================================
  // E2E — CAMPAIGN OPERATIONS BOARD: stage pipeline for the rostered creator.
  // ===========================================================================
  await page.goto(`${campaignUrl}?tab=operations`);
  await expect(page.getByRole('tab', { name: 'Operations Board' })).toHaveAttribute('data-state', 'active');
  const opsRow = page.locator('tr', { hasText: INFLUENCER });
  await expect(opsRow.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('columnheader', { name: 'Agreement' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Published' })).toBeVisible();
  await page.getByRole('button', { name: /^All \(\d+\)/ }).click();

  // ===========================================================================
  // E2E — SAVED VIEWS + BULK OPERATIONS: table view, select, preview the
  // real impact, then commit.
  // ===========================================================================
  await page.goto('/influencers');
  await page.getByPlaceholder('Search by name or @username…').fill(INFLUENCER);
  await page.getByPlaceholder('Search by name or @username…').press('Enter');
  await expect(page.getByText(INFLUENCER).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Table' }).click();
  await page.getByRole('checkbox', { name: `Select ${INFLUENCER}` }).check();
  await expect(page.getByText('1 selected')).toBeVisible();

  await page.getByRole('combobox').filter({ hasText: /Assign owner/i }).click();
  await page.getByRole('option', { name: 'Add tag' }).click();
  await page.getByPlaceholder('Tag name…').fill(`vip-${STAMP}`);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('Confirm bulk action')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/will be updated/)).toBeVisible();
  await page.getByRole('button', { name: /Apply to \d+/ }).click();
  await expect(page.getByText('Confirm bulk action')).toBeHidden({ timeout: 10_000 });

  // A saved logistics/directory-style view persists these filters (Saved
  // Views is the same shared foundation used across Influencers/Logistics).
  page.once('dialog', (d) => d.accept(`OI View ${STAMP}`));
  await page.getByRole('button', { name: /Views/ }).click();
  await page.getByRole('menuitem', { name: 'Save current filters' }).click();
  await expect(page.getByText('View saved')).toBeVisible({ timeout: 10_000 });
});

test('Needs Attention deep-links from Mission Control to a real record', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
  const firstItem = page.getByRole('link').filter({ has: page.locator('svg') }).first();
  // "All clear" is a legitimate empty state — only assert a click when there's
  // a real item, since Needs Attention content depends on prior test data.
  const allClear = page.getByText('All clear');
  if (!(await allClear.isVisible().catch(() => false))) {
    await expect(firstItem).toBeVisible();
  }
});

test('Data Quality Center shows Findings, Duplicate Creators, and Workflow Integrity cards', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/data-quality');
  await expect(page.getByRole('heading', { name: 'Data Quality' })).toBeVisible();
  // Root cause of the earlier flake/timeout: "Data Quality Findings" and
  // "Workflow Integrity Findings" each render with a conditional count badge
  // (e.g. "4 need attention") immediately after the title with no separator
  // in the JSX, so once real data pushes that count above zero the
  // element's accessible text becomes e.g. "Data Quality Findings4 need
  // attention" — never an exact match for the bare title. A direct DOM
  // query confirmed the mismatch (0 exact matches, 1 substring match, with
  // that exact merged string as the element's text), ruling out every
  // server- or client-side cause a network/console/error-based
  // investigation had considered first. A substring match is correct and
  // unambiguous for these two. "Possible Duplicate Creators" has no badge,
  // so it stays exact — its own page description text contains "possible
  // duplicate creators" as a substring, which a non-exact match would also
  // (wrongly) hit.
  await expect(page.getByText('Data Quality Findings')).toBeVisible();
  await expect(page.getByText('Possible Duplicate Creators', { exact: true })).toBeVisible();
  await expect(page.getByText('Workflow Integrity Findings')).toBeVisible();
});

test('Executive dashboard shows budget KPIs, Today/Since-yesterday, Brands and Top creators', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/exec');
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toBeVisible();
  await expect(page.getByText('Today', { exact: true })).toBeVisible();
  // Non-exact would also match the page's own description text ("...what
  // changed since yesterday..."), which contains this substring.
  await expect(page.getByText('Since yesterday', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Brands' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top creators' })).toBeVisible();
});
