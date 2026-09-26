import { expect, test as base } from '@playwright/test';

/**
 * The specs' `test`: every `page.goto` also waits for the page to settle
 * (no requests for half a second) before the test acts on it.
 *
 * A click or typed text that lands while React is still taking over the
 * server-rendered page can be lost: the link doesn't navigate, the dialog
 * doesn't open, Send stays disabled. Measured on this app: about 1 in 12
 * clicks made straight after the load event were lost, none after settling.
 * People rarely click that fast; tests always do.
 *
 * Settling is capped and never fails a test by itself — if a page keeps the
 * network busy, the test carries on as it would have without it.
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      return response;
    };
    await provide(page);
  },
});

export { expect };
