import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Browser verification of the Advanced Roles, Country Scoping & Logistics
 * Operations pass — the 11 numbered E2E scenarios from the spec (E2E —
 * LOGISTICS ROLE / DIRECT SECURITY / GENERAL MANAGER / INFLUENCER MANAGER /
 * ADDRESS CLARIFICATION / ADDRESS RESOLUTION / LOGISTICS CHAT / SHIPMENT
 * COMMENT / COUNTRY FILTERS / SAVED LOGISTICS VIEW / ROLE CHANGE). The
 * backend integration suite already proves the authorization rules at the
 * HTTP layer (logistics-issue.test.ts, logistics-cross-surface.test.ts,
 * logistics-address-privacy.test.ts, influencer-country-scope.test.ts); this
 * drives the same scenarios through the real rendered UI, across four real
 * logins (Admin, a KW-only Logistics operator, an unrestricted General
 * Manager, a KW-only Influencer Manager), to catch what typecheck/lint and
 * `app.inject()` cannot — broken selectors, dead client components, and
 * country-scoped data that's silently visible (or silently hidden) in the
 * actual browser.
 */

const ADMIN = { email: 'e2e-browser-test@influenceos.app', password: 'E2eTest-Passw0rd!' };
const STAMP = Date.now();
const BRAND = `LogX Brand ${STAMP}`;
const CAMPAIGN = `LogX Campaign ${STAMP}`;
const SARA = `LogX Sara ${STAMP}`; // Kuwait creator — the incomplete (no phone) shipment.
const KHALED = `LogX Khaled ${STAMP}`; // Saudi creator — the complete, out-of-KW-scope shipment.
const PASSWORD = 'Str0ng-Passw0rd!';
const AHMED_EMAIL = `logx-ahmed-${STAMP}@example.test`;
const MONA_EMAIL = `logx-mona-${STAMP}@example.test`;
const GRACE_EMAIL = `logx-grace-${STAMP}@example.test`;

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  // Rapidly clearing cookies and re-logging in (switching actors mid-journey,
  // below) occasionally races the edge middleware's own auth redirect — retry
  // the whole sequence once rather than let a harness-only timing hiccup fail
  // the run (a real user never re-logs-in within milliseconds of signing out).
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

/** Switch actors mid-journey: drop the current session and log in as someone else. */
async function switchTo(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await signIn(page, email, password);
}

async function openQuickAdd(page: Page, item: string) {
  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Admin → Users: create a STAFF account and assign it a Role Profile + (optionally) a country scope. */
async function createScopedUser(
  page: Page,
  opts: { name: string; email: string; roleProfileLabel: string; countryNames?: string[] },
) {
  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await page.getByRole('button', { name: 'Add user' }).click();
  const addDialog = page.getByRole('dialog');
  await addDialog.getByPlaceholder('Jane Doe').fill(opts.name);
  await addDialog.getByPlaceholder('jane@brand.com').fill(opts.email);
  await addDialog.getByPlaceholder('••••••••').fill(PASSWORD);
  await addDialog.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.locator('tr', { hasText: opts.email }).getByRole('button', { name: 'Edit access' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(opts.email)).toBeVisible();

  // Combobox order in the sheet: [0] Legacy role, [1] Role Profile.
  await sheet.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: opts.roleProfileLabel, exact: true }).click();

  if (opts.countryNames?.length) {
    await sheet.getByRole('tab', { name: /Countries/ }).click();
    for (const name of opts.countryNames) {
      await sheet.getByPlaceholder('Search countries…').fill(name);
      await sheet.locator('label', { hasText: name }).locator('input[type="checkbox"]').check();
    }
  }

  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** Fill a Collaboration Layer composer and click its own Send button — `scope`
 *  must be narrow enough that exactly one "Send" button resolves within it
 *  (the shipment sheet or the page when no dialog is open), since the docked
 *  Logistics Team Chat panel and a shipment's own Comments both use the same
 *  composer component. */
async function submitComposer(scope: Page | Locator, placeholder: string | RegExp, body: string) {
  const box = scope.getByPlaceholder(placeholder);
  await box.fill(body);
  await scope.getByRole('button', { name: 'Send' }).click();
}

test('Advanced Roles & Logistics Operations — 11 scenario browser journey', async ({ page }) => {
  test.setTimeout(420_000);

  // ===========================================================================
  // SETUP (as Admin) — a brand, two creators in two different countries, a
  // campaign, and one shipment per creator (Sara/KW deliberately missing a
  // phone number so it drives the Address Clarification workflow).
  // ===========================================================================
  await signIn(page, ADMIN.email, ADMIN.password);

  await openQuickAdd(page, 'Brand');
  const brandDialog = page.getByRole('dialog');
  await brandDialog.getByRole('textbox').first().fill(BRAND);
  await brandDialog.getByRole('button', { name: /create brand/i }).click();
  await page.waitForURL(/\/brands\//);
  await expect(page.getByRole('dialog')).toBeHidden();

  for (const [name, handle] of [
    [SARA, `sara${STAMP}`],
    [KHALED, `khaled${STAMP}`],
  ] as const) {
    await openQuickAdd(page, 'Influencer');
    const infDialog = page.getByRole('dialog');
    await infDialog.getByPlaceholder('https://instagram.com/creator').fill(`https://www.youtube.com/@${handle}`);
    await infDialog.getByPlaceholder('Full or display name').fill(name);
    await infDialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Kuwait', exact: true }).click();
    await infDialog.getByRole('button', { name: /add influencer/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  // Influencer Country (LOGX-11) — the canonical countryCode, distinct from
  // Shipment Destination Country. A new shipment snapshots its destination
  // from the creator's countryCode at creation time, so this must happen
  // BEFORE the shipments below are created.
  for (const [name, countryName] of [
    [SARA, 'Kuwait'],
    [KHALED, 'Saudi Arabia'],
  ] as const) {
    await page.goto('/influencers');
    await page.getByPlaceholder('Search by name or @username…').fill(name);
    await page.getByPlaceholder('Search by name or @username…').press('Enter');
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.getByRole('button', { name: 'Edit influencer' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: countryName, exact: true }).click();
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  await openQuickAdd(page, 'Campaign');
  const campDialog = page.getByRole('dialog');
  await campDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: BRAND }).click();
  await campDialog.getByPlaceholder('Summer Glow Launch').fill(CAMPAIGN);
  await campDialog.getByRole('button', { name: /create campaign/i }).click();
  await page.waitForURL(/\/campaigns\//);
  await expect(page.getByRole('dialog')).toBeHidden();
  const campaignId = page.url().split('/campaigns/')[1]!.split(/[/?]/)[0]!;

  // The campaign workspace groups its views into six areas (P2.8).
  await page.getByRole('tab', { name: 'Roster' }).click();
  await page.getByRole('tab', { name: 'Influencers' }).click();
  for (const name of [SARA, KHALED]) {
    await page.getByRole('button', { name: 'Add influencer' }).click();
    const addInf = page.getByRole('dialog');
    await addInf.getByPlaceholder('Search by name or @username…').fill(name);
    await addInf.getByRole('button', { name }).click();
    await addInf.getByRole('button', { name: /add to campaign/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  // The campaign workspace groups its views into six areas (P2.8).
  await page.getByRole('tab', { name: 'Logistics & budget' }).click();
  await page.getByRole('tab', { name: 'Shipments' }).click();
  // Sara/KW — deliberately no phone, drives the Address Clarification flow.
  await page.getByRole('button', { name: 'Create shipment' }).click();
  let shipDialog = page.getByRole('dialog');
  await shipDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: SARA }).click();
  let tb = shipDialog.getByRole('textbox');
  await tb.nth(0).fill('Sara Creator');
  await tb.nth(2).fill('Street 12, Building 4');
  await tb.nth(3).fill('Kuwait City');
  await tb.nth(4).fill('Kuwait');
  await tb.nth(5).fill('Skincare Kit');
  await shipDialog.getByRole('button', { name: 'Create shipment' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Khaled/SA — a complete address, used to prove country-scope exclusion.
  await page.getByRole('button', { name: 'Create shipment' }).click();
  shipDialog = page.getByRole('dialog');
  await shipDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: KHALED }).click();
  tb = shipDialog.getByRole('textbox');
  await tb.nth(0).fill('Khaled Creator');
  await tb.nth(1).fill('+966500000000');
  await tb.nth(2).fill('Olaya Street 5');
  await tb.nth(3).fill('Riyadh');
  await tb.nth(4).fill('Saudi Arabia');
  await tb.nth(5).fill('Skincare Kit');
  await shipDialog.getByRole('button', { name: 'Create shipment' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Resolve Khaled's shipment id via the same authenticated browser session's
  // API (used only for the direct-by-id security checks below — the row
  // itself is never opened by Admin here, only by an out-of-scope actor).
  const shipmentsList = await page
    .request.get('/api/bff/api/v1/shipments?limit=50')
    .then((r) => r.json() as Promise<{ data: { id: string; influencer: { displayName: string } | null }[] }>);
  const khaledShipment = shipmentsList.data.find((s) => s.influencer?.displayName === KHALED)!;

  // Resolve Khaled's influencer id the same way, as Admin (unrestricted) —
  // Mona's own (KW-scoped) list can never surface him at all, by design, so
  // her direct-ID check below needs the id from an actor who CAN see him.
  const khaledInfluencer = await page
    .request.get(`/api/bff/api/v1/influencers?q=${encodeURIComponent(KHALED)}&limit=5`)
    .then((r) => r.json() as Promise<{ data: { id: string; displayName: string }[] }>)
    .then((body) => body.data.find((i) => i.displayName === KHALED)!);

  // Admin → Users: Ahmed (Logistics, KW only), Mona (Influencer Manager, KW
  // only), Grace (General Manager, unrestricted — zero country rows).
  await createScopedUser(page, { name: 'LogX Ahmed', email: AHMED_EMAIL, roleProfileLabel: 'Logistics', countryNames: ['Kuwait'] });
  await createScopedUser(page, { name: 'LogX Mona', email: MONA_EMAIL, roleProfileLabel: 'Influencer Manager', countryNames: ['Kuwait'] });
  await createScopedUser(page, { name: 'LogX Grace', email: GRACE_EMAIL, roleProfileLabel: 'General Manager' });

  // ===========================================================================
  // 65 — E2E: LOGISTICS ROLE. Ahmed (KW-only Logistics) sees Kuwait shipments,
  // never Saudi ones, and has no access to system/user administration.
  // 66 — E2E: DIRECT SECURITY. A direct call for the Saudi shipment id is
  //      rejected (404, not merely hidden UI).
  // ===========================================================================
  await switchTo(page, AHMED_EMAIL, PASSWORD);
  await page.goto('/logistics');
  await expect(page.getByRole('heading', { name: 'Logistics' })).toBeVisible();
  await expect(page.getByText(SARA).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(KHALED)).toHaveCount(0);

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();

  const directHit = await page.request.get(`/api/bff/api/v1/shipments/${khaledShipment.id}`);
  expect(directHit.status()).toBe(404);

  // ===========================================================================
  // 69 — E2E: ADDRESS CLARIFICATION. Ahmed opens Sara's (KW, his own scope)
  // shipment and requests clarification — the shipment's real ShipmentStatus
  // is untouched; a single LogisticsIssue record drives the blocker.
  // ===========================================================================
  await page.goto('/logistics');
  await page.getByText(SARA).first().click();
  const shipmentSheet = page.getByRole('dialog');
  await expect(shipmentSheet.getByText('Creator country: Kuwait')).toBeVisible();
  await shipmentSheet.getByRole('button', { name: 'Request Address Clarification' }).click();
  await shipmentSheet.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Missing Phone' }).click();
  await shipmentSheet.getByPlaceholder(/building number is missing/i).fill('Phone number is unreachable — please confirm.');
  // Wait on the actual network responses, not just the eventual UI update —
  // the badge reads from the invalidated shipments-list refetch, not the
  // POST response itself, so both waits are registered up front (before the
  // click) so neither can race past a response that lands before we'd
  // otherwise start listening. A non-2xx on either shows up as a precise
  // failure here instead of a vague "badge never appeared" UI timeout.
  const [issueResp, listResp] = await Promise.all([
    page.waitForResponse((r) => /\/shipments\/[^/]+\/issues$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/v1/shipments') && r.request().method() === 'GET', { timeout: 30_000 }),
    shipmentSheet.getByRole('button', { name: 'Send request' }).click(),
  ]);
  expect(issueResp.ok(), `POST .../issues failed: ${issueResp.status()} ${await issueResp.text().catch(() => '<no body>')}`).toBeTruthy();
  expect(listResp.ok(), `GET .../shipments (list refetch) failed: ${listResp.status()}`).toBeTruthy();
  await expect(shipmentSheet.getByText('Clarification Requested')).toBeVisible({ timeout: 10_000 });
  await expect(shipmentSheet.getByText('Phone number is unreachable')).toBeVisible();

  // Close the sheet before touching anything behind its overlay — the
  // docked Logistics Chat panel sits underneath and is not interactable
  // while the modal Sheet overlay is up.
  await shipmentSheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // ===========================================================================
  // 71 — E2E: LOGISTICS CHAT. Always-open, docked on the same /logistics
  // screen, reusing the existing Collaboration Layer.
  // ===========================================================================
  await expect(page.getByText('Logistics Chat').first()).toBeVisible({ timeout: 25_000 });
  const teamChatMessage = `Aramex pickup moved to 3 PM — ${STAMP}`;
  await submitComposer(page, 'Message the logistics team… use @ to mention someone', teamChatMessage);
  await expect(page.getByText(teamChatMessage)).toBeVisible({ timeout: 25_000 });

  // ===========================================================================
  // 72 — E2E: SHIPMENT COMMENT. A shipment-scoped comment stays scoped to
  //      that shipment — never leaks into the general Logistics Team Chat.
  // ===========================================================================
  await page.getByText(SARA).first().click();
  const commentSheet = page.getByRole('dialog');
  const shipmentComment = `Building number confirmed as 12B — ${STAMP}`;
  await submitComposer(commentSheet, 'Comment on this shipment… use @ to mention someone', shipmentComment);
  await expect(commentSheet.getByText(shipmentComment)).toBeVisible({ timeout: 25_000 });
  await commentSheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  // The shipment-scoped comment is a distinct conversation from the docked
  // team chat — its own body text never appears in the team chat's list.
  await expect(page.getByText(shipmentComment)).toHaveCount(0);
  await expect(page.getByText(teamChatMessage)).toBeVisible();

  // ===========================================================================
  // 74 — E2E: SAVED LOGISTICS VIEW. Reuses the existing generic SavedViews
  // component/schema — no second filter-preset system.
  // ===========================================================================
  await page.getByRole('button', { name: 'My Queue', exact: true }).click();
  const viewName = `My Kuwait Address Issues ${STAMP}`;
  page.once('dialog', (d) => d.accept(viewName));
  await page.getByRole('button', { name: /Views/ }).click();
  await page.getByRole('menuitem', { name: 'Save current filters' }).click();
  await expect(page.getByText('View saved')).toBeVisible({ timeout: 25_000 });
  // The dropdown's onSelect calls preventDefault() (to let window.prompt()
  // render without Radix auto-closing the menu first) — close it explicitly.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Save current filters' })).toBeHidden();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: /Views/ }).click();
  await page.getByRole('menuitem', { name: viewName }).click();
  await expect(page).toHaveURL(/assigneeId=me/);

  // ===========================================================================
  // 67 — E2E: GENERAL MANAGER. Sees every country's logistics, but not
  //      system/user administration or provider secrets.
  // 73 — E2E: COUNTRY FILTERS (the General Manager side — unrestricted).
  // ===========================================================================
  await switchTo(page, GRACE_EMAIL, PASSWORD);
  await page.goto('/logistics');
  await expect(page.getByText(SARA).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(KHALED).first()).toBeVisible({ timeout: 30_000 });

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();

  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Social Integrations' })).toBeVisible();
  await expect(page.getByText('Provider API keys')).toHaveCount(0);

  // ===========================================================================
  // 68 — E2E: INFLUENCER MANAGER. Mona (KW-only) sees Kuwait creators, not
  // Saudi ones; sees the cross-surface Logistics Issue warning on Sara's
  // Creator 360; cannot reach user administration.
  // Direct-ID (spec item 50) — Mona (KW) hitting Khaled's (SA) creator id
  // directly must be rejected too, not just filtered out of a list.
  // ===========================================================================
  await switchTo(page, MONA_EMAIL, PASSWORD);
  // This dev database carries substantial leftover data from prior test
  // runs, so the directory's default (unfiltered) first page is not a
  // reliable place to look for one specific row — search for each creator
  // by name instead, which is itself real server-side filtering (LOGX-11),
  // not a client-side page-content check.
  await page.goto('/influencers');
  await page.getByPlaceholder('Search by name or @username…').fill(SARA);
  await page.getByPlaceholder('Search by name or @username…').press('Enter');
  await expect(page.getByRole('link', { name: SARA }).first()).toBeVisible({ timeout: 30_000 });

  await page.getByPlaceholder('Search by name or @username…').fill(KHALED);
  await page.getByPlaceholder('Search by name or @username…').press('Enter');
  // Wait for this search to land before checking — otherwise the count below
  // passes on the previous page and the next search races this one.
  await expect(page).toHaveURL(/[?&]q=LogX\+Khaled/, { timeout: 30_000 });
  // Results are links; the search itself also shows as a filter chip (P2.8).
  await expect(page.getByRole('link', { name: KHALED })).toHaveCount(0);

  await page.getByPlaceholder('Search by name or @username…').fill(SARA);
  await page.getByPlaceholder('Search by name or @username…').press('Enter');
  await expect(page).toHaveURL(/[?&]q=LogX\+Sara/, { timeout: 30_000 });
  await page.getByRole('link', { name: SARA }).first().click();
  await expect(page.getByRole('heading', { name: SARA })).toBeVisible();
  await expect(page.getByText(/Logistics needs address clarification/i)).toBeVisible({ timeout: 30_000 });

  const directInfluencerHit = await page.request.get(`/api/bff/api/v1/influencers/${khaledInfluencer.id}`);
  expect(directInfluencerHit.status()).toBe(404);

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();

  // ===========================================================================
  // 70 — E2E: ADDRESS RESOLUTION (as Admin — unrestricted, so this also
  // exercises the Campaign Operations Board + Needs Attention cross-surface
  // read before and after resolution). Fixing/resolving is a separate real
  // PATCH, never a silent auto-rewrite of the shipment.
  // ===========================================================================
  await switchTo(page, ADMIN.email, ADMIN.password);

  await page.goto(`/campaigns/${campaignId}?tab=operations`);
  await expect(page.getByRole('tab', { name: 'Operations Board' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('button', { name: /Needs Attention \(\d+\)/ })).toBeVisible({ timeout: 30_000 });
  const saraOpsRow = page.locator('tr', { hasText: SARA });
  await expect(saraOpsRow.locator('span[title*="Address Clarification"]')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
  await expect(page.getByText(/address clarification/i).first()).toBeVisible({ timeout: 30_000 });

  await page.goto('/logistics');
  await page.getByText(SARA).first().click();
  const resolveSheet = page.getByRole('dialog');
  // The address "Edit" comes first; the comment thread below can add its own
  // "Edit" buttons once it has loaded, so never rely on there being just one.
  await resolveSheet.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await resolveSheet.getByRole('textbox').nth(1).fill('+96550000000'); // Phone (2nd field in the edit form)
  await resolveSheet.getByRole('button', { name: 'Save' }).click();
  await expect(resolveSheet.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible({ timeout: 25_000 });

  await resolveSheet.getByRole('button', { name: 'Resolve' }).click();
  await expect(resolveSheet.getByText(/Resolved by/)).toBeVisible({ timeout: 25_000 });
  await expect(resolveSheet.getByRole('button', { name: 'Request Address Clarification' })).toBeVisible();
  await resolveSheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/influencers');
  await page.getByPlaceholder('Search by name or @username…').fill(SARA);
  await page.getByPlaceholder('Search by name or @username…').press('Enter');
  await page.getByRole('link', { name: SARA }).click();
  await expect(page.getByText(/Logistics needs address clarification/i)).toHaveCount(0);

  // ===========================================================================
  // 75 — E2E: ROLE/SCOPE CHANGE. Admin widens Ahmed's country access
  // (KW → KW + SA). A country-access change is resolved fresh per request
  // (mirrors brand scope) — no session revoke is needed for it to take
  // effect, unlike a role/roleProfile change (SEC-03). Ahmed's very next
  // request, on a freshly re-established session, must reflect the new scope
  // immediately — no stale authorization.
  // ===========================================================================
  await page.goto('/settings/users');
  await page.locator('tr', { hasText: AHMED_EMAIL }).getByRole('button', { name: 'Edit access' }).click();
  const ahmedSheet = page.getByRole('dialog');
  await ahmedSheet.getByRole('tab', { name: /Countries/ }).click();
  await ahmedSheet.getByPlaceholder('Search countries…').fill('Saudi Arabia');
  await ahmedSheet.locator('label', { hasText: 'Saudi Arabia' }).locator('input[type="checkbox"]').check();
  await ahmedSheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await switchTo(page, AHMED_EMAIL, PASSWORD);
  await page.goto('/logistics');
  await expect(page.getByText(SARA).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(KHALED).first()).toBeVisible({ timeout: 30_000 });
});
