import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Requires the full stack running (API :4000 + web :3000 + a seeded
 * database). Locally:  pnpm dev  (in another terminal)  then  pnpm --filter
 * @influenceos/web e2e. Chromium is pre-provisioned in CI images.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // CI's "Full stack E2E" job runs Postgres+Redis+MinIO+API+worker+web+a real
  // browser on one shared 2-core runner. The worker's recurring maintenance
  // sweep used to fire every minute there (MONITOR_CRON), colliding with
  // concurrent Playwright page loads and causing exactly this symptom —
  // fixed at the source in ci.yml (the sweep only needs to run once at
  // startup; the job's own health check is satisfied by that one-shot run,
  // not the recurring cadence). This CI-only default bump is a secondary
  // safety margin on top of that fix, for genuinely slower (not broken)
  // round trips under a shared, resource-constrained runner in general —
  // it never weakens what's asserted or touches the faster local dev loop.
  expect: { timeout: process.env.CI ? 20_000 : 10_000 },
  fullyParallel: true,
  // Multiple heavy multi-step specs (each standing up a brand/campaign/content
  // fixture through several real UI round trips) running concurrently against
  // one shared API+DB can starve each other on a modest CI runner and blow a
  // spec's own timeout on nothing more than page-load latency. Serialize in
  // CI; locally a developer is normally running one file at a time anyway.
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Locally, point at a pre-provisioned Chromium (PW_CHROMIUM_PATH) to
        // avoid a version-pinned download; in CI this is unset and Playwright
        // uses the browser it installs itself.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
});
