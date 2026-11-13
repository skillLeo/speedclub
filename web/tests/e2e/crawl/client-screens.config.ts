// Playwright config of the client preview screenshots (client-screens.spec.ts; run command in its header).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['client-screens.spec.ts'],
  outputDir: '../test-results/client-screens',
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
