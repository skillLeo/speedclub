// Playwright config of the H1 bug hunt (QA 2026-11-23, docs/reports/qa-full/bugs-hunt.md): flows through the real member web on
// /app for account, garage, vehicle page, sticker/QR, STREET DEX and settings, on the two devices of the hunt brief.
//   nice -n 15 node scripts/dev/qa-run.mjs npx --prefix web playwright test --config=tests/e2e/hunt/hunt.config.ts
// Separate from tests/e2e/playwright.config.ts so the hunt runs on its own (one worker, owner rule), without the e2e global setup's
// staff fixtures. Members it creates live under E2E_DOMAIN with the prefix `garage.hunt` and are removed in the teardown.
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, QA_LOCALES, QA_TIMEZONE } from '../support/qa.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  outputDir: '../test-results/hunt',
  forbidOnly: true,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalTimeout: 60 * 60_000,
  globalSetup: './setup.ts',
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    locale: QA_LOCALES.de,
    timezoneId: QA_TIMEZONE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone15pro', use: { ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 } } },
    { name: 'desktop1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
});
