// R4B-007 (client round 4 hunt, Medium): a nested screen opened directly (shared link, QR, bookmark, reload) goes "Zurück" to its
// parent, never to the tab root Expo Router puts under it (which arrived with the screen's own parameters: /app/discover?slug=…,
// /app/profile?key=…). Read only: demo data of the seeded showcase; the member session is the demo member lukas.sc.
import type { Page } from '@playwright/test';
import { DEMO_MEMBER, sessionOf, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { qaUrl } from '../support/qa.mjs';

const SLUG = 'nissan-skyline-gt-r-r34-5tf974vj';

async function backFrom(page: Page, path: string, headerId: string): Promise<URL> {
  await page.goto(qaUrl(path));
  const back = page.locator(`[data-testid="${headerId}.back"]:visible`).first();
  await expect(back).toBeVisible({ timeout: 30_000 });
  const opened = new URL(page.url()).pathname;
  await back.click();
  await page.waitForURL((url) => url.pathname !== opened, { timeout: 30_000 });
  return new URL(page.url());
}

test.describe('R4B-007 back from a direct link', () => {
  test.beforeEach(async ({ context }) => {
    await useSession(context, await sessionOf(DEMO_MEMBER));
  });

  test('VEH-03 gallery → the vehicle page', async ({ page }) => {
    const url = await backFrom(page, `/app/v/${SLUG}/gallery`, 'VEH-03.header');
    expect(url.pathname).toBe(`/app/v/${SLUG}`);
    expect(url.search).toBe('');
  });

  test('VEH-08 history → the vehicle page', async ({ page }) => {
    const url = await backFrom(page, `/app/v/${SLUG}/history`, 'VEH-08.header');
    expect(url.pathname).toBe(`/app/v/${SLUG}`);
    expect(url.search).toBe('');
  });

  test('PROF-04 connections → the member profile', async ({ page }) => {
    const url = await backFrom(page, '/app/u/kenji.r34/connections', 'PROF-04.header');
    expect(url.pathname).toBe('/app/u/kenji.r34');
    expect(url.search).toBe('');
  });

  test('FOR-02 forum category → Forum', async ({ page }) => {
    const url = await backFrom(page, '/app/forum/c/bremsen', 'FOR-02.header');
    expect(url.pathname).toBe('/app/forum');
    expect(url.search).toBe('');
  });

  test('SET-14 help article → Hilfe', async ({ page }) => {
    const url = await backFrom(page, '/app/settings/help/block-report', 'SET-14.reader.header');
    expect(url.pathname).toBe('/app/settings/help');
    expect(url.search).toBe('');
  });
});

// R4B-002: the browser title follows the screen after client-side navigation (it kept the first page's share title).
test.describe('R4B-002 browser title', () => {
  test.beforeEach(async ({ context }) => {
    await useSession(context, await sessionOf(DEMO_MEMBER));
  });

  test('a vehicle page names the car, and Garage names Garage after the tab switch', async ({ page }) => {
    await page.goto(qaUrl(`/app/v/${SLUG}`));
    await expect(page).toHaveTitle(/Skyline.*\| Speedclub$/, { timeout: 30_000 });
    await page.locator('[data-testid="tab.garage"]:visible').first().click();
    await page.waitForURL(/\/app\/garage/);
    await expect(page).toHaveTitle(/\| Speedclub$/);
    await expect(page).not.toHaveTitle(/Skyline/);
  });
});
