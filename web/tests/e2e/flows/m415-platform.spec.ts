// M4.15 Platform (09 §8.13–§8.16), app part, Chromium: the member web as a home-screen app — manifest, startup images and the
// service worker as the export serves them, the worker registering with the shell precached and no API answer in any cache, the
// "Neue Version verfügbar" toast (through the non-production hook `window.__scPwa.simulateUpdate()`, since a second export cannot
// be built inside a test), the install hint and its dismissal; SET-09's browser row (hidden without a VAPID key, offered with
// one, ADR-452); and MEM-01 behind its flag `membership`.
//
// The other specs block service workers (playwright.config.ts); this file allows them for its own contexts. WebKit is skipped:
// Playwright's WebKit has no service worker support for page.route and these checks are about the Chromium install path; the
// iPhone picture of the install hint is the visual cell SET-01-install.
import type { Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { de, id, members, open, pathOf, row } from '../support/flow';
import { BASE_URL } from '../support/qa.mjs';

test.skip(({ browserName }) => browserName !== 'chromium', 'service worker and install prompt checks run on Chromium');
test.use({ serviceWorkers: 'allow' });

type PwaHook = { simulateUpdate: () => void; registered: () => Promise<string | null> };

/** The registration's script once the worker is active (the hook of src/features/pwa/serviceWorker.ts). */
async function activeWorker(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? null;
  });
}

test.describe('M4.15 member web as an installed app', () => {
  test('the export serves the manifest, its icons, the startup images and a filled-in worker', async ({ request }) => {
    const manifest = await request.get(`${BASE_URL}/app/manifest.webmanifest`);
    expect(manifest.status()).toBe(200);
    const body = (await manifest.json()) as { scope: string; start_url: string; display: string; icons: { src: string; purpose: string }[] };
    expect(body).toMatchObject({ scope: '/app/', start_url: '/app/', display: 'standalone' });
    expect(body.icons.map((icon) => icon.purpose)).toContain('maskable');
    for (const icon of body.icons) {
      const file = await request.get(`${BASE_URL}${icon.src}`);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()['content-type']).toContain('image/png');
    }

    const index = await (await request.get(`${BASE_URL}/app/`)).text();
    expect(index).toContain('<link rel="manifest" href="/app/manifest.webmanifest" />');
    expect(index).toContain('<link rel="apple-touch-icon" href="/app/pwa/apple-touch-icon.png" />');
    expect(index).toContain('black-translucent');
    expect(index).not.toContain('<!--sc:pwa-startup-->');
    const startup = [...index.matchAll(/rel="apple-touch-startup-image"[^>]*href="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(startup.length).toBeGreaterThanOrEqual(10);
    expect((await request.get(`${BASE_URL}${startup[0]}`)).status()).toBe(200);

    const worker = await (await request.get(`${BASE_URL}/app/sw.js`)).text();
    expect(worker).toMatch(/const VERSION = '[0-9a-f]{12}';/);
    const precache = JSON.parse(/const PRECACHE = (\[[^\]]*\]);/.exec(worker)?.[1] ?? '[]') as string[];
    expect(precache).toContain('/app/');
    expect(precache).toContain('/app/manifest.webmanifest');
    expect(precache.some((url) => url.startsWith('/app/_expo/static/js/'))).toBe(true);
    expect(precache.every((url) => url.startsWith('/app/'))).toBe(true);
  });

  test('the worker registers on /app/, precaches the shell and keeps no API answer', async ({ page }) => {
    await open(page, '/app/');
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    await expect.poll(() => activeWorker(page), { timeout: 30_000 }).toBe(`${BASE_URL}/app/sw.js`);
    expect(await page.evaluate(() => (window as unknown as { __scPwa: PwaHook }).__scPwa.registered())).toBe(`${BASE_URL}/app/sw.js`);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
      return { names, urls };
    });
    expect(cached.names.some((name) => name.startsWith('sc-shell-'))).toBe(true);
    expect(cached.urls).toContain('/app/');
    expect(cached.urls.filter((url) => url.startsWith('/api/'))).toEqual([]);
  });

  test('a waiting new version offers "Neu laden", and the tap reloads the page', async ({ page }) => {
    await open(page, '/app/');
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    await page.evaluate(() => (window as unknown as { __scPwa: PwaHook }).__scPwa.simulateUpdate());
    const toast = id(page, 'shell.pwaUpdate');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(de('common', 'pwa.update.message'));
    const reloaded = page.waitForEvent('load');
    await id(page, 'shell.pwaUpdate.action').click();
    await reloaded;
    await expect(id(page, 'HOME-01.root')).toBeVisible();
  });

  test('the install hint shows once and goes with "Verstanden"', async ({ page, context }) => {
    const [me] = await members('m415hint');
    await useSession(context, me.session);
    await page.goto(`/app/settings?qaTheme=carbon&qaLocale=de&qaMotion=off&qaOpen=installHint`);
    const sheet = id(page, 'shell.installHint');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(de('common', 'pwa.install.title'));
    // A Chromium window without the browser's install event: the steps, with Safari's share glyph first.
    await expect(id(page, 'shell.installHint.step.share')).toContainText(de('common', 'pwa.install.steps.share'));
    await id(page, 'shell.installHint.dismiss').click();
    await expect(page.locator('[data-testid="shell.installHint"]:visible')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('sc.installHint'))).toBe('dismissed');
    // Without the override an automated browser never gets it, and a member who saw it does not either.
    await open(page, '/app/settings');
    await expect(id(page, 'SET-01.root')).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(page.locator('[data-testid="shell.installHint"]:visible')).toHaveCount(0);
  });

  test('SET-09: no browser row without a VAPID key, the row with one', async ({ page, context }) => {
    const [me] = await members('m415push');
    await useSession(context, me.session);
    await open(page, '/app/settings/notifications?qaFlags=web_push');
    await expect(id(page, 'SET-09.push')).toBeVisible();
    await expect(page.locator('[data-testid="SET-09.webPush"]')).toHaveCount(0);

    // ADR-452: the key arrives with app-config (lane B); here the answer is given one. A P-256 point, 65 bytes.
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    await page.route('**/api/v1/app-config', async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { data: Record<string, unknown> };
      json.data.web_push = { vapid_public_key: key };
      await route.fulfill({ response, json, headers: { ...response.headers(), etag: '"m415"' } });
    });
    await page.evaluate(() => localStorage.removeItem('sc.appConfig'));
    // Headless Chromium answers "denied" until the context grants notifications: the row says how to allow them.
    await open(page, '/app/settings/notifications?qaFlags=web_push');
    await expect(id(page, 'SET-09.webPush.denied')).toContainText(de('settings', 'notifications.webPush.helperDenied'));
    await expect(id(page, 'SET-09.webPush.denied.switch')).toHaveAttribute('aria-disabled', 'true');

    // chrome-headless-shell keeps "denied" even after grantPermissions, so the undecided browser of a real member is staged here.
    await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'default' }));
    await open(page, '/app/settings/notifications?qaFlags=web_push');
    await expect(id(page, 'SET-09.webPush.off')).toContainText(de('settings', 'notifications.webPush.title'));
    await expect(id(page, 'SET-09.webPush.off')).toContainText(de('settings', 'notifications.webPush.helperOff'));
    await expect(id(page, 'SET-09.webNote')).toContainText(de('settings', 'notifications.webPush.phoneNote'));
  });
});

test.describe('M4.15 MEM-01 Mitgliedschaft (flag membership)', () => {
  test('is not there while the flag is off', async ({ page }) => {
    await open(page, '/app/membership');
    await expect(id(page, 'SYS-03.root')).toBeVisible();
    await expect(page.locator('[data-testid="MEM-01.root"]')).toHaveCount(0);
  });

  test('with the flag: the paywall scaffold with no price, a disabled purchase and the legal links; SET-01 leads there', async ({ page, context }) => {
    const [me] = await members('m415member');
    await useSession(context, me.session);
    await open(page, '/app/settings?qaFlags=membership');
    await row(page, 'SET-01.membership').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/membership');
    await expect(id(page, 'SET-24.plan')).toContainText(de('settings', 'membership.plan'));

    await open(page, '/app/membership?qaFlags=membership');
    await expect(id(page, 'MEM-01.content')).toBeVisible();
    await expect(id(page, 'MEM-01.sample')).toBeVisible();
    await expect(id(page, 'MEM-01.cta')).toHaveAttribute('aria-disabled', 'true');
    await expect(id(page, 'MEM-01.cta')).toContainText(de('settings', 'membership.cta'));
    await expect(id(page, 'MEM-01.content')).not.toContainText(/\d|€/);
    await id(page, 'MEM-01.legal.privacy').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/legal/privacy');
  });
});
