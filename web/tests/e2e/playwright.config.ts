import { availableParallelism } from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, QA_LOCALES, QA_TIMEZONE } from './support/qa.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: ['flows/**/*.spec.ts', 'a11y/**/*.spec.ts', 'parity/**/*.spec.ts', 'self-test/**/*.spec.ts'],
  outputDir: 'test-results',
  // A committed .only would silently turn off the rest of the safety net.
  forbidOnly: true,
  fullyParallel: true,
  // A flaky test is a bug in the test or the app; retries would hide it.
  retries: 0,
  // Gradle and other builds share this machine; WebKit on Windows starves first when oversubscribed. RISK-4, the WebKit
  // stall at a click on the Windows PC (screencast frames stop, the page still answers; microsoft/playwright#43818), did not
  // come back on the Mac at these workers (3) with other projects' builds at a load average of 55 on 10 cores (M1.9,
  // docs/reports/logs/m19-mac-te-e2e-headworkers-1.log): no render probe read "stopped". Should it return on Windows, the
  // proposal is `workers: 1` on the webkit project (ADR to write then), not retries or longer ceilings.
  workers: Math.min(4, Math.max(2, Math.floor(availableParallelism() / 3))),
  // Wait ceilings, not quality thresholds: a passing test is no slower for having them.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // A worker stuck in teardown must fail the gate, not block it forever (seen once with axe on WebKit). A ceiling for the
  // whole suite, sized to it: 663 tests took 11 min (M1.5); with M1.6 and M1.7 (903 tests, axe on 31 more screens, flows
  // that upload real photos) 20 min ended a healthy run half way.
  globalTimeout: 60 * 60_000,
  globalSetup: './support/global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    locale: QA_LOCALES.de,
    timezoneId: QA_TIMEZONE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
    {
      name: 'webkit',
      // Engine-independent: planner, runner and baselines. Axe: its results do not depend on the
      // engine here, and its extra blank page left a WebKit worker hanging in teardown.
      testIgnore: ['**/self-test/visual-matrix.spec.ts', '**/a11y/axe*.spec.ts'],
      use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
    },
  ],
});
