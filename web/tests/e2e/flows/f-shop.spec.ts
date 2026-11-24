// M5.5 Shop on the member web (docs/10_CLIENT_ROUND_1.md §3, contract docs/reports/phase-5/m5.5-contract.md §3, ADR-502, ADR-519):
// since client round 5 (R5-3) SHOP-01 is three category cards, SHOP-03 `/shop/c/sticker` lists the stickers with "Dein Sticker",
// an old `/shop?category=` link forwards there, SHOP-02 shows a product and "Im Shop kaufen" opens exactly
// the address the server built, in a new tab, never one the app composed. With the flag `shop` off the tab keeps the M5.2 shell.
//
// The local seed (ShopSampleSeeder, contract §7) has three sticker samples and no store. Since client round 4 (R4-3.2) all three
// categories show, the coming ones with "Bald verfügbar" and not selectable. One answer is the harness's, built on the
// server's own: the detail of a store product with an external `buy`, as the
// server answers once a store is configured (OA-44). The new tab is caught where it opens (`window.open`): the shop's host is a
// third party the test context blocks, and opening it is not what this asserts.
import { devices, type Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { BASE_URL, makeContextDeterministic, qaUrl, waitForStablePage } from '../support/qa.mjs';

type Card = { id: string; slug: string; title: string; purchase_mode: 'shopify' | 'sticker_designer'; category: { key: string } };
type Buy = { available: boolean; kind: string | null; url: string | null; path: string | null; reason: string | null; message: string | null };

const STAGED_URL = 'https://shop.joinspeedclub.com/products/schriftzug-banner';
const id = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Records every `window.open` of the page instead of opening a tab. */
async function catchNewTabs(page: Page) {
  await page.addInitScript(() => {
    const opened: [string, string, string][] = [];
    (window as unknown as { __opened: typeof opened }).__opened = opened;
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      opened.push([String(url ?? ''), target ?? '', features ?? '']);
      return null;
    }) as typeof window.open;
  });
  return () => page.evaluate(() => (window as unknown as { __opened: [string, string, string][] }).__opened);
}

test.describe('Shop (M5.5)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('three categories → Sticker → product → back → "Im Shop kaufen" opens the exact server URL', async ({ page, qaGoto }) => {
    const opened = await catchNewTabs(page);
    const cardsResponse = await page.request.get('/api/v1/shop/products', { headers: { Accept: 'application/json' } });
    expect(cardsResponse.status(), 'the flag shop is on outside production (contract §8)').toBe(200);
    const cards = ((await cardsResponse.json()) as { data: Card[] }).data;
    const storeProduct = cards.find((card) => card.purchase_mode === 'shopify');
    expect(storeProduct, 'the seed has a store product (Schriftzug-Banner)').toBeTruthy();
    const product = storeProduct as Card;

    // SHOP-01 (R5-3, R5DQ-01): the large title and exactly three categories, nothing else of the catalogue. Sticker leads and opens;
    // Kleidung and Accessoires are tiles with "Bald verfügbar" on the photo and cannot be opened (R4-3.2). No count anywhere.
    await qaGoto('/app/shop');
    await expect(id(page, 'SHOP-01.categories')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="SHOP-01.category."][role="link"]:visible')).toHaveCount(3);
    await expect(page.locator('[data-testid^="SHOP-01.product."]:visible')).toHaveCount(0);
    await expect(id(page, 'SHOP-01.promo')).toHaveCount(0);
    await expect(id(page, 'SHOP-01.hero')).toHaveCount(0);
    await expect(id(page, 'SHOP-01.category.all')).toHaveCount(0);
    await expect(id(page, 'SHOP-01.category.sticker.title')).toHaveText('Sticker');
    // R5DQ-01: Sticker is the lead (no "Verfügbar" pill), the coming ones a row of tiles under it.
    await expect(id(page, 'SHOP-01.category.sticker.available')).toHaveCount(0);
    const lead = await id(page, 'SHOP-01.category.sticker.photo').boundingBox();
    const tile = await id(page, 'SHOP-01.category.apparel.photo').boundingBox();
    expect((tile?.y ?? 0) > (lead?.y ?? 0) + (lead?.height ?? 0), 'the coming tiles sit under the lead').toBe(true);
    expect((tile?.height ?? 0) < (lead?.height ?? 0) / 2, 'a coming tile is clearly smaller than the lead').toBe(true);
    await expect(id(page, 'SHOP-01.category.sticker')).not.toHaveAttribute('aria-disabled', 'true');
    for (const coming of ['apparel', 'accessories']) {
      await expect(id(page, `SHOP-01.category.${coming}.soon`)).toHaveText('Bald verfügbar');
      await expect(id(page, `SHOP-01.category.${coming}`)).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(id(page, 'SHOP-01.category.apparel.title')).toHaveText('Kleidung');
    await id(page, 'SHOP-01.category.apparel').click({ force: true });
    expect(pathOf(page)).toBe('/app/shop');

    // SHOP-03: the sticker products and "Dein Sticker" with its one order action.
    await id(page, 'SHOP-01.category.sticker').click();
    await expect.poll(() => pathOf(page)).toBe('/app/shop/c/sticker');
    await expect(id(page, `SHOP-03.product.${product.slug}`)).toBeVisible({ timeout: 30_000 });
    await expect(id(page, `SHOP-03.product.${product.slug}.vat`)).toHaveText('inkl. MwSt.');
    for (const card of cards.filter((entry) => entry.category.key === 'sticker')) await expect(id(page, `SHOP-03.product.${card.slug}`)).toBeVisible();
    await expect(id(page, 'SHOP-03.promo')).toBeVisible();
    await expect(id(page, 'SHOP-03.promo.point.meets')).toHaveText('Beim Treffen scannen die Leute, statt zu fragen.');
    await expect(id(page, 'SHOP-03.promo.order')).toHaveText('Sticker bestellen');

    // SHOP-02, and back to SHOP-03.
    await id(page, `SHOP-03.product.${product.slug}`).click();
    await expect.poll(() => pathOf(page)).toBe(`/app/shop/${product.slug}`);
    await expect(id(page, 'SHOP-02.title')).toHaveText(product.title);
    await id(page, 'SHOP-02.header.back').click();
    await expect.poll(() => pathOf(page)).toBe('/app/shop/c/sticker');
    await expect(id(page, `SHOP-03.product.${product.slug}`)).toBeVisible();
    await id(page, `SHOP-03.product.${product.slug}`).click();
    await expect.poll(() => pathOf(page)).toBe(`/app/shop/${product.slug}`);

    // SHOP-02 as the server answers it, and then with a store: the external buy is the server's string, opened as given.
    await expect(id(page, 'SHOP-02.title')).toHaveText(product.title);
    await expect(id(page, 'SHOP-02.vat')).toHaveText('inkl. MwSt., zzgl. Versand');
    const detail = (await (await page.request.get(`/api/v1/shop/products/${product.slug}`, { headers: { Accept: 'application/json' } })).json()) as {
      data: { buy: Buy };
    };
    if (detail.data.buy.available && detail.data.buy.kind === 'external' && detail.data.buy.url) {
      await id(page, 'SHOP-02.buy').click();
      await expect.poll(opened).toEqual([[detail.data.buy.url, '_blank', 'noopener,noreferrer']]);
      return;
    }
    // No store configured (the local default): disabled with the server's line, nothing opens.
    await expect(id(page, 'SHOP-02.buy')).toHaveText(detail.data.buy.message ?? 'Bald im Shop erhältlich');
    await expect(id(page, 'SHOP-02.buy')).toBeDisabled();
    expect(await opened()).toEqual([]);

    await page.route(`**/api/v1/shop/products/${product.slug}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.buy = { available: true, kind: 'external', url: STAGED_URL, path: null, reason: null, message: null };
      body.data.store = { configured: true, host: 'shop.joinspeedclub.com', shipping_url: 'https://shop.joinspeedclub.com/policies/shipping-policy' };
      await route.fulfill({ response, json: body });
    });
    await qaGoto(`/app/shop/${product.slug}`);
    await expect(id(page, 'SHOP-02.buy')).toHaveText('Im Shop kaufen', { timeout: 30_000 });
    await expect(id(page, 'SHOP-02.buy')).toHaveAttribute('aria-label', 'Im Shop kaufen, öffnet den Online-Shop shop.joinspeedclub.com');
    await expect(id(page, 'SHOP-02.buyNote')).toHaveText('Du wechselst zum Online-Shop shop.joinspeedclub.com. Bezahlt wird dort, nie in der App.');
    await id(page, 'SHOP-02.buy').click();
    await expect.poll(opened).toEqual([[STAGED_URL, '_blank', 'noopener,noreferrer']]);
    await id(page, 'SHOP-02.shipping').click();
    await expect.poll(async () => (await opened()).at(-1)?.[0]).toBe('https://shop.joinspeedclub.com/policies/shipping-policy');
  });

  test('the designer product leads to the stickers; a guest is asked to sign in', async ({ page, qaGoto }) => {
    const cards = ((await (await page.request.get('/api/v1/shop/products', { headers: { Accept: 'application/json' } })).json()) as { data: Card[] }).data;
    const designer = cards.find((card) => card.purchase_mode === 'sticker_designer');
    test.skip(!designer, 'no designer product in this catalogue');
    await qaGoto(`/app/shop/${designer?.slug ?? ''}`);
    await expect(id(page, 'SHOP-02.buy')).toHaveText('Sticker gestalten', { timeout: 30_000 });
    await id(page, 'SHOP-02.buy').click();
    await expect(id(page, 'shell.authRequired.signIn')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/shop/${designer?.slug ?? ''}`);
  });

  test('old /shop?category= links forward to SHOP-03; a coming category shows "Bald verfügbar" and the way back', async ({ page, qaGoto }) => {
    await qaGoto('/app/shop?category=sticker');
    await expect.poll(() => pathOf(page), { timeout: 30_000 }).toBe('/app/shop/c/sticker');
    await expect(id(page, 'SHOP-03.promo')).toBeVisible({ timeout: 30_000 });
    await qaGoto('/app/shop?category=apparel');
    await expect.poll(() => pathOf(page), { timeout: 30_000 }).toBe('/app/shop/c/apparel');
    await expect(id(page, 'SHOP-03.soon')).toBeVisible({ timeout: 30_000 });
    await expect(id(page, 'SHOP-03.title')).toHaveText('Kleidung');
    await expect(page.locator('[data-testid^="SHOP-03.product."]:visible')).toHaveCount(0);
    await expect(id(page, 'SHOP-03.empty')).toHaveCount(0);
    await page.getByRole('button', { name: 'Zum Shop' }).click();
    await expect.poll(() => pathOf(page)).toBe('/app/shop');
    await expect(id(page, 'SHOP-01.categories')).toBeVisible({ timeout: 30_000 });
  });

  // R5-4 (client, phone web): react-native-web turns `scrollEnabled={false}` into `touch-action: none`, so the single photo of a
  // product in a disabled pager blocked the page's vertical scroll whenever a drag started on it. On a touch phone (iPhone on WebKit,
  // Pixel on Chromium) nothing under the photo or the text may carry `touch-action: none`, and in Chromium a real touch drag (CDP
  // touch events, which scroll like a finger) that starts on the photo, and one on the text, moves the page.
  test('SHOP-02 with one photo scrolls by touch from the photo and from the text', async ({ browser, browserName }) => {
    const device = browserName === 'webkit' ? devices['iPhone 14'] : devices['Pixel 7'];
    const { defaultBrowserType: _type, ...descriptor } = device;
    const context = await browser.newContext({ ...descriptor, baseURL: BASE_URL, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    try {
      await makeContextDeterministic(context);
      const page = await context.newPage();
      const slug = 'schriftzug-banner';
      await page.route(`**/api/v1/shop/products/${slug}`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.data.images = body.data.images.slice(0, 1);
        await route.fulfill({ response, json: body });
      });
      await page.goto(qaUrl(`/app/shop/${slug}`));
      await waitForStablePage(page);
      await expect(id(page, 'SHOP-02.gallery.page.0')).toBeVisible({ timeout: 30_000 });
      await expect(id(page, 'SHOP-02.gallery.pages')).toHaveCount(0);

      const scroller = id(page, 'SHOP-02.scroll');
      const center = async (testId: string) => {
        const box = (await id(page, testId).boundingBox()) as { x: number; y: number; width: number; height: number };
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      /** Scrolls the page to `top` and waits until it stays there (a previous drag's fling has run out). */
      const settleAt = async (top: 'start' | 'end') =>
        expect
          .poll(async () => {
            const target = await scroller.evaluate((node, to) => {
              const end = to === 'start' ? 0 : node.scrollHeight - node.clientHeight;
              node.scrollTop = end;
              return end;
            }, top);
            await page.waitForTimeout(400);
            return Math.abs((await scroller.evaluate((node) => node.scrollTop)) - target) <= 1;
          })
          .toBe(true);
      // The photo, with the page at its top; the title, with the page at its end (on a short phone the title starts under the
      // floating tab bar, which is not the page). Each start point must be the page's content, and none may sit under
      // `touch-action: none`.
      await settleAt('start');
      const photo = { name: 'photo', ...(await center('SHOP-02.gallery.page.0')), dy: -25 };
      await settleAt('end');
      const text = { name: 'text', ...(await center('SHOP-02.title')), dy: 25 };
      for (const point of [photo, text]) {
        await settleAt(point.name === 'photo' ? 'start' : 'end');
        const probe = await page.evaluate(({ x, y }) => {
          const blocked: string[] = [];
          const hit = document.elementFromPoint(x, y);
          for (let node = hit; node; node = node.parentElement) {
            if (getComputedStyle(node).touchAction === 'none') blocked.push(node.getAttribute('data-testid') ?? node.tagName);
          }
          return { blocked, onPage: Boolean(hit?.closest('[data-testid="SHOP-02.scroll"]')) };
        }, point);
        expect(probe.onPage, `the ${point.name} is the page's content, not the tab bar`).toBe(true);
        expect(probe.blocked, `touch-action: none under the ${point.name}`).toEqual([]);
      }
      if (browserName !== 'chromium') return;
      const cdp = await context.newCDPSession(page);
      for (const point of [photo, text]) {
        await settleAt(point.name === 'photo' ? 'start' : 'end');
        // A touch while the last fling still runs at the edge only stops that fling; give it time to end.
        await page.waitForTimeout(1000);
        const before = await scroller.evaluate((node) => node.scrollTop);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
        for (let step = 1; step <= 10; step += 1) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + step * point.dy }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        // Up from the photo moves the page down; down from the text moves it back up.
        await expect
          .poll(async () => Math.abs((await scroller.evaluate((node) => node.scrollTop)) - before), { message: `a drag from the ${point.name} scrolls the page` })
          .toBeGreaterThan(40);
      }
    } finally {
      await context.close();
    }
  });

  test('flag off: the tab keeps the M5.2 shell, and a product link shows it too', async ({ page, qaGoto }) => {
    await page.route('**/api/v1/app-config', async (route) => {
      // Always the full answer: the app's second load sends its stored ETag, and a 304 cannot carry the patched flags.
      const { 'if-none-match': _etag, ...headers } = route.request().headers();
      const response = await route.fetch({ headers });
      if (response.status() !== 200) return route.continue();
      const body = await response.json();
      body.data.flags = { ...body.data.flags, shop: false };
      await route.fulfill({ response, json: body });
    });
    await qaGoto('/app/shop');
    await expect(id(page, 'SHOP-01.closed.title')).toHaveText('Der Speedclub Shop zieht hier ein', { timeout: 30_000 });
    await expect(id(page, 'SHOP-01.stickers')).toBeVisible();
    await expect(id(page, 'SHOP-01.list')).toHaveCount(0);
    await qaGoto('/app/shop/car-sticker');
    await expect(id(page, 'SHOP-02.closed')).toBeVisible({ timeout: 30_000 });
  });
});
