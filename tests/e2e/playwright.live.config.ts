import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the LIVE-site read-only smoke suite.
 *
 * Target a production WordPress install (default https://fabiodalez.it) and run
 * ONLY tests/e2e/specs-live/* — the self-contained, read-only compliance
 * invariants. The mutating ./specs suite (admin writes, wp-cli fixtures,
 * plugin (de)activation, fixture-banner assumptions) is intentionally NOT run
 * here: it would corrupt real settings and pollute real GDPR consent logs.
 *
 *   npm run test:live            # against https://fabiodalez.it
 *   WP_BASE_URL=https://staging… npm run test:live   # any other target
 *
 * No globalSetup: the smoke suite needs no admin login and must never seed or
 * reset data on a production database.
 */
const baseURL = process.env.WP_BASE_URL ?? 'https://fabiodalez.it';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './specs-live',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  // Production sits behind a CDN/cache (QUIC.cloud); a couple of retries absorb
  // transient edge hiccups without masking a real regression.
  retries: 2,
  workers: 1,
  outputDir: './reports/live-artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: './reports/live-html', open: 'never' }],
    ['json', { outputFile: './reports/live-results.json' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
