import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration/DoD suites share one Postgres database, so run files serially
    // to keep row-level fixtures deterministic.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: 'default',
  },
});
