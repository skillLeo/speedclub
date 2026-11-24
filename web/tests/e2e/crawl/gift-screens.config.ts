// Playwright config of the M5.9f owner screenshots of the gift features (gift-screens.spec.ts; run command in its header).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['gift-screens.spec.ts'],
  outputDir: '../test-results/gift-screens',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  globalSetup: './setup.ts',
  reporter: [['list']],
  use: {
    ...devices['iPhone 15 Pro'],
    viewport: { width: 393, height: 852 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'off',
  },
});
