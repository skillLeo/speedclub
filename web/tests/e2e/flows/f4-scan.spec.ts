// F4 Stranger scans a QR without the app (02_PRODUCT_SPEC §4, §3.4, WEB-01, WEB-06): the camera opens /C/{CODE}, the
// server resolves it, revoked, private and unknown codes get the WEB-06 state with no way to the vehicle, an active one is
// a 302 to the canonical /v/{slug}, rendered by the server, with the sticky bar "In der App öffnen" + "Registrieren", and
// sign-up keeps next=/v/{slug} and returns there. The scan is counted as a number per day, never for the owner or a bot.
// A signed-in member goes on to the member web app (ADR-148 i), and the app's own resolver /app/c/[code] (QR-RESOLVE)
// answers the same states, cleans up a typed code and handles errors, rate limits and no connection.
//
// The demo codes (support/garage.mjs QR_STATES) are only read. Every scan counts (QrScans, also through the app's resolver),
// and the seeded R34's count shows on the QR-02 the visual matrix takes, so the active code scanned here is the sticker of a
// build made for this file. A code that changes (reissue, delete, counting) belongs to a fresh member under E2E_DOMAIN; the
// global teardown deletes them. Native counterpart: mobile/e2e/maestro/f4-scan.yaml.
import type { Locator, Page } from '@playwright/test';
import { applyAuth, useSession } from '../support/auth.mjs';
import { E2E_DOMAIN, qrScans, resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { noteDeletedMedia } from '../support/deleted-media.mjs';
import { BBS_WHEELS, buildVehicle, createGarageMember, expectStatus, QR_STATES, R34 } from '../support/garage.mjs';
import { BASE_URL, qaUrl } from '../support/qa.mjs';
import { expectText, expectTextContaining } from '../support/text.mjs';

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const BLADE_PAGE = `/v/${R34.slug}`;
const APP_PAGE = `/app/v/${R34.slug}`;

type Sticker = { code: string; slug: string; owner: string; bladePage: string; appPage: string };
let made: Promise<Sticker> | null = null;
/** The active sticker this file scans: a published Skyline GT-R R34 with a photo and a mod, one per worker. */
function sticker(): Promise<Sticker> {
  made ??= (async () => {
    const owner = await createGarageMember('f4sticker');
    const vehicle = await buildVehicle(owner.api, { photos: 1, mods: [BBS_WHEELS] });
    const code = vehicle.qr?.code as string;
    return { code, slug: vehicle.slug, owner: owner.username, bladePage: `/v/${vehicle.slug}`, appPage: `/app/v/${vehicle.slug}` };
  })();
  return made;
}
const scanUrl = (code: string): RegExp => new RegExp(`/[cC]/${code}$`);

/** Where /C/{code} sends a browser, without following it. */
async function redirectOf(page: Page, path: string): Promise<{ status: number; location: string | null }> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  const location = response.headers().location;
  return { status: response.status(), location: location ? new URL(location, BASE_URL).pathname : null };
}

test.describe('F4 a stranger scans the sticker', () => {
  test('an active code is a 302 to the canonical page, which the server renders with photos, specs, mods and owner', async ({ page, browser }) => {
    const { code, bladePage, owner } = await sticker();
    expect(await redirectOf(page, `/C/${code}`)).toEqual({ status: 302, location: bladePage });
    // Routes take /c/ and /C/, and the code in either case (§3.4).
    expect(await redirectOf(page, `/c/${code.toLowerCase()}`)).toEqual({ status: 302, location: bladePage });

    const response = await page.goto(`/C/${code}`);
    expect(response?.status()).toBe(200);
    expect(pathOf(page)).toBe(bladePage);
    await expect(id(page, 'WEB-01.root')).toBeVisible();
    await expect(id(page, 'VEH-01.eyebrow')).toHaveText('NISSAN');
    await expect(id(page, 'VEH-01.title')).toHaveText('Skyline GT-R R34');
    await expect(page.locator('[data-testid="VEH-01.hero"] img').first()).toBeVisible();
    await expect(id(page, 'VEH-01.specStrip')).toContainText('Baujahr');
    await expect(id(page, 'WEB-01.mods')).toBeVisible();
    await expect(id(page, 'VEH-01.ownerRow')).toContainText(`@${owner}`);

    // The bar of F4 on a phone: the app (or the member web without it) and sign-up that comes back here.
    const bar = id(page, 'WEB-01.stickyBar');
    await expect(bar).toBeVisible();
    await expect(id(page, 'WEB-01.openInApp')).toHaveText('In der App öffnen');
    await expect(id(page, 'WEB-01.register')).toHaveText('Registrieren');
    const register = new URL((await id(page, 'WEB-01.register').getAttribute('href')) ?? '', BASE_URL);
    expect(register.pathname).toBe('/app/sign-up');
    expect(register.searchParams.get('next')).toBe(bladePage);

    // Server-rendered: the same page without JavaScript has everything the scan is for.
    const noScript = await browser.newContext({ javaScriptEnabled: false, baseURL: BASE_URL });
    try {
      const plain = await noScript.newPage();
      await plain.goto(`/C/${code}`);
      await expect(plain.locator('[data-testid="VEH-01.title"]')).toHaveText('Skyline GT-R R34');
      await expect(plain.locator('[data-testid="VEH-01.specStrip"]')).toBeVisible();
      await expect(plain.locator('[data-testid="WEB-01.register"]').first()).toBeVisible();
    } finally {
      await noScript.close();
    }
  });

  for (const [state, { code, status, title }] of Object.entries(QR_STATES)) {
    test(`a ${state} code answers ${status} with the WEB-06 state and nothing of the vehicle`, async ({ page, expectFailedResponses }) => {
      expectFailedResponses([{ status, url: scanUrl(code) }]);
      const response = await page.goto(`/C/${code}`);
      expect(response?.status()).toBe(status);
      expect(pathOf(page)).toBe(`/C/${code}`);
      const root = id(page, 'WEB-06.root');
      await expect(root).toBeVisible();
      await expect(root).toHaveAttribute('data-state', state === 'notFound' ? 'not_found' : state);
      await expectText(id(page, 'WEB-06.title'), title);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      // No link to a vehicle page, and no word of which vehicle it was.
      await expect(root.locator('a[href*="/v/"]')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('Skyline');
      await expect(id(page, 'WEB-06.discover')).toHaveAttribute('href', `${BASE_URL}/app/discover`);
    });
  }

  test('Registrieren keeps the page and returns there after sign-up', async ({ page }) => {
    await resetAuthLimits();
    const email = `f4.register.${Date.now().toString(36)}@${E2E_DOMAIN}`;
    await page.goto(BLADE_PAGE);
    await id(page, 'WEB-01.register').click();
    await expect(id(page, 'AUTH-04.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('next')).toBe(BLADE_PAGE);

    await id(page, 'AUTH-04.email').fill(email);
    await id(page, 'AUTH-04.password').fill(`Ladeluft-${Date.now().toString(36)}-Kurve`);
    for (const consent of ['ageConfirmed', 'termsAccepted', 'privacyAccepted']) await id(page, `AUTH-04.${consent}`).click();
    await id(page, 'AUTH-04.cta.primary').click();
    await expect(id(page, 'AUTH-05.root')).toBeVisible();
    const mail = await waitForMail(email, (m) => m.code !== null);
    await id(page, 'AUTH-05.code').fill(mail.code as string);
    await expect(id(page, 'AUTH-08.root')).toBeVisible();
    await id(page, 'AUTH-08.username').fill(`f4${Date.now().toString(36)}`);
    await expect(id(page, 'AUTH-08.available')).toBeVisible();
    await id(page, 'AUTH-08.cta.primary').click();
    await expect(id(page, 'AUTH-09.root')).toBeVisible();
    await id(page, 'AUTH-09.skip').click();

    // Back at the build the sticker belongs to, now in the member web app.
    await expect(id(page, 'VEH-01.title')).toHaveText('Skyline GT-R R34');
    expect(pathOf(page)).toBe(APP_PAGE);
  });

  test('a signed-in member who scans goes on to the member web app', async ({ page, context }) => {
    const { code, bladePage, appPage } = await sticker();
    await applyAuth(context, 'member-empty');
    expect(await redirectOf(page, bladePage)).toEqual({ status: 302, location: appPage });
    await page.goto(`/C/${code}`);
    await expect(id(page, 'VEH-01.title')).toHaveText('Skyline GT-R R34');
    expect(pathOf(page)).toBe(appPage);
    await expect(id(page, 'WEB-01.root')).toHaveCount(0);
  });

  test('a scan counts as a number for the day, and neither the owner nor a bot counts', async ({ page, browser }) => {
    const owner = await createGarageMember('f4count');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    const code = vehicle.qr?.code as string;
    expect((await qrScans(code)).total).toBe(0);

    await page.goto(`/C/${code}`);
    await expect(id(page, 'WEB-01.root')).toBeVisible();
    expect((await qrScans(code)).total).toBe(1);

    // The owner checking the own sticker, then a crawler: neither is a scan.
    const ownerContext = await browser.newContext({ baseURL: BASE_URL });
    try {
      await useSession(ownerContext, owner.session);
      const ownPage = await ownerContext.newPage();
      await ownPage.goto(`/C/${code}`);
      await expect(ownPage.locator('[data-testid="VEH-01.title"]:visible')).toBeVisible();
    } finally {
      await ownerContext.close();
    }
    const bot = await page.request.get(`/C/${code}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, maxRedirects: 0 });
    expect(bot.status()).toBe(302);
    const counted = await qrScans(code);
    expect(counted.total).toBe(1);
    // What a counter row holds: the code, the day and the number. No address, no account, no browser.
    expect(counted.columns.sort()).toEqual(['count', 'day', 'id', 'qr_code_id']);
  });

  test('a replaced sticker is no longer valid, and the code of a deleted vehicle says so', async ({ page, expectFailedResponses }) => {
    const owner = await createGarageMember('f4reissue');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    const old = vehicle.qr?.code as string;
    const reissued = expectStatus(await owner.api.post(`vehicles/${vehicle.id}/qr/reissue`), 200, 'POST reissue').data;
    const fresh = (reissued.code ?? reissued.qr?.code) as string;
    expect(fresh).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(fresh).not.toBe(old);
    expectFailedResponses([
      { status: 410, url: scanUrl(old) },
      { status: 410, url: scanUrl(fresh) },
    ]);

    expect(await redirectOf(page, `/C/${fresh}`)).toEqual({ status: 302, location: `/v/${vehicle.slug}` });
    expect((await page.goto(`/C/${old}`))?.status()).toBe(410);
    await expectText(id(page, 'WEB-06.title'), QR_STATES.revoked.title);

    noteDeletedMedia(vehicle); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
    expectStatus(await owner.api.delete(`vehicles/${vehicle.id}`), 204, 'DELETE vehicle');
    expect((await page.goto(`/C/${fresh}`))?.status()).toBe(410);
    await expect(id(page, 'WEB-06.title')).toHaveText('Dieses Fahrzeug ist nicht mehr verfügbar');
    await expect(id(page, 'WEB-06.root').locator('a[href*="/v/"]')).toHaveCount(0);
  });
});

test.describe('the in-app resolver /app/c/[code]', () => {
  test('an active code replaces itself with the vehicle, also typed with spaces, hyphens or in lower case', async ({ page }) => {
    const { code, appPage } = await sticker();
    for (const typed of [code, `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase(), `${code.slice(0, 4)}%20${code.slice(4)}`]) {
      await page.goto(qaUrl(`/app/c/${typed}`));
      await expect(id(page, 'VEH-01.title'), typed).toHaveText('Skyline GT-R R34');
      expect(pathOf(page)).toBe(appPage);
    }
  });

  for (const [state, { code, title }] of Object.entries(QR_STATES)) {
    test(`a ${state} code shows the WEB-06 wording and stays on /app/c`, async ({ page }) => {
      await page.goto(qaUrl(`/app/c/${code}`));
      await expect(id(page, `QR-RESOLVE.state.${state === 'notFound' ? 'not_found' : state}`)).toBeVisible();
      await expectText(id(page, 'QR-RESOLVE.title'), title);
      expect(pathOf(page)).toBe(`/app/c/${code}`);
      await expect(page.locator('[data-testid^="QR-RESOLVE"] a[href*="/v/"]')).toHaveCount(0);
      await id(page, 'QR-RESOLVE.discover').click();
      await expect(id(page, 'DISC-01.root')).toBeVisible();
    });
  }

  test('an impossible code is not found without asking the server', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/qr/')) asked.push(r.url());
    });
    await page.goto(qaUrl('/app/c/ILOU'));
    await expect(id(page, 'QR-RESOLVE.state.not_found')).toBeVisible();
    expect(asked).toEqual([]);
  });

  test('a server error offers a retry that resolves, and a rate limit asks to wait', async ({ page, expectFailedResponses }) => {
    const resolver = /\/api\/v1\/qr\/[^/?]+(\?.*)?$/;
    expectFailedResponses([
      { status: 500, url: resolver },
      { status: 429, url: resolver },
    ]);
    let answer: number | null = 500;
    await page.route(resolver, (route) =>
      answer === null
        ? route.fallback()
        : route.fulfill({
            status: answer,
            contentType: 'application/json',
            headers: answer === 429 ? { 'Retry-After': '30' } : {},
            body: JSON.stringify(answer === 429 ? { message: 'Zu viele Anfragen.', code: 'rate_limited' } : { message: 'Server Error' }),
          }),
    );
    const { code, appPage } = await sticker();
    await page.goto(qaUrl(`/app/c/${code}`));
    await expectText(id(page, 'QR-RESOLVE.error.title'), 'Der QR-Code konnte nicht geprüft werden');
    answer = null;
    await id(page, 'QR-RESOLVE.error.action').click();
    await expect(id(page, 'VEH-01.title')).toHaveText('Skyline GT-R R34');
    expect(pathOf(page)).toBe(appPage);

    answer = 429;
    await page.goto(qaUrl(`/app/c/${code}`));
    await expect(id(page, 'QR-RESOLVE.error.title')).toHaveText('Kurz durchatmen');
    await expect(id(page, 'QR-RESOLVE.error')).toContainText('Das waren gerade sehr viele Aufrufe.');
  });

  test('without a connection it says what it needs, and resolves once the connection is back', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: /\/api\/v1\/qr\// }]);
    const { code, appPage } = await sticker();
    // The resolver's code is loaded with a first scan; the second one happens without a connection.
    await page.goto(qaUrl(`/app/c/${QR_STATES.revoked.code}`));
    await expect(id(page, 'QR-RESOLVE.state.revoked')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate((code) => {
      window.history.pushState(null, '', `/app/c/${code}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, code);
    await expect(id(page, 'QR-RESOLVE.offline')).toBeVisible();
    await expect(id(page, 'QR-RESOLVE.error.title')).toHaveText('Du bist offline');
    await expectTextContaining(id(page, 'QR-RESOLVE.error'), 'Um den QR-Code zu prüfen, brauchst du eine Verbindung.');
    // Back online, the paused check runs by itself and lands on the vehicle.
    await context.setOffline(false);
    await expect(id(page, 'VEH-01.title')).toHaveText('Skyline GT-R R34');
    expect(pathOf(page)).toBe(appPage);
  });
});
