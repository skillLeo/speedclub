// Playwright config of the showcase crawl (showcase.spec.ts; run commands in its header). Separate from tests/e2e/playwright.config.ts:
// the e2e global setup creates and deletes test accounts and staff fixtures through support/backend.php, which only works on this
// machine, and the crawl must also run against staging.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['showcase.spec.ts'],
  outputDir: '../test-results/crawl',
  forbidOnly: true,
  fullyParallel: true,
  // A flaky page is a finding, not something to retry.
  retries: 0,
  // Two pages at a time keep a whole run far below the server's per-address limits (public_read 300 a minute, search 60), which a
  // person never reaches either. CRAWL_WORKERS raises it for a quick local look.
  workers: Number(process.env.CRAWL_WORKERS ?? 2),
  // Wait ceilings for a whole role × device run (about 60 to 120 pages), not quality thresholds.
  timeout: 90 * 60_000,
  globalTimeout: 4 * 60 * 60_000,
  globalSetup: './setup.ts',
  reporter: [['list']],
  use: {
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      // The primary member-web device of 09 §14.1 (visual/p4-devices.mjs): the whole screen as the viewport, as a home-screen app.
      name: 'iphone15pro',
      use: { ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 } },
      // The admin is desktop-only (ADR-212).
      grepInvert: /@desktop-only/,
      metadata: { device: 'iPhone 15 Pro · WebKit 393×852', mobile: true },
    },
    {
      // The Android member web (client QA 2026-11-23). Chromium is the only engine that emulates CSS env(safe-area-inset-*) (CDP
      // Emulation.setSafeAreaInsetsOverride, probed on Chromium 156; WebKit cannot), so the safe-area check runs here with the iPhone
      // 15 Pro home-screen insets (59 px status bar and camera, 34 px home indicator): larger than a Pixel's, so the stricter case of
      // the same CSS. The iPhone project above checks the tab bar with the insets WebKit gives a page (0).
      name: 'pixel7',
      use: { ...devices['Pixel 7'] },
      grepInvert: /@desktop-only/,
      metadata: { device: 'Pixel 7 · Chromium 412×839', mobile: true, safeArea: { top: 59, bottom: 34 } },
    },
    {
      name: 'desktop1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      metadata: { device: 'Desktop 1440 · Chromium', mobile: false },
    },
    {
      name: 'desktop1440-webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      metadata: { device: 'Desktop 1440 · WebKit', mobile: false },
    },
  ],
});
