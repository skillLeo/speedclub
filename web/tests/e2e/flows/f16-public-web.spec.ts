// F16 Public web 2.0 (M4.16, docs/09_PREMIUM_2_0.md §9): the server-rendered pages a stranger reaches from a shared link or a
// scanned sticker. WEB-03 tells the QR story and links into the real builds and meets; WEB-13 /e/{slug} shows a meet as a guest
// sees it (the exact place of an after_rsvp meet never), opens the app to answer and offers the calendar file; maps and routes
// leave for openstreetmap.org only on a tap, so no page makes a third-party request (the base fixture fails on one); WEB-02 lists
// the garage as VehicleCards 2.0, whose photos, the first card's included, follow the cover (DQ-1237, M4.18 LCP). Every page reads
// without JavaScript and holds at 360 px and at 200 % text.
//
// Data: the seeded sample meets of the SPEED CLUB Editorial account (stable slugs, ShowcaseEvents), lukas.sc's and jann.ptrs's garages
// (DemoSeeder). Only reads; nothing here changes data.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { BASE_URL, qaUrl } from '../support/qa.mjs';

const HAFEN = 'abendtreffen-am-hafen-klahfh';
const PRIVATE = 'abendtreffen-im-sueden-m5ovqb';
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** The page is no wider than the window: nothing scrolls sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

test.describe('F16 public web 2.0', () => {
  test('WEB-03 tells the QR story from the hero link and leads into a real build and a real meet', async ({ page }) => {
    await page.goto('/');
    await expect(id(page, 'WEB-03.claim')).toHaveText('Dein Auto. Dein Build. Dein Club.');
    await expect(id(page, 'WEB-03.openWebApp')).toHaveAttribute('href', `${BASE_URL}/app`);

    await id(page, 'WEB-03.howQr').click();
    await expect(page).toHaveURL(/#qr$/);
    await expect(id(page, 'WEB-03.steps')).toBeInViewport();
    await expect(id(page, 'WEB-03.qr')).toBeVisible();

    await id(page, 'WEB-03.featuredLink').click();
    await expect(id(page, 'WEB-01.root')).toBeVisible();
    expect(pathOf(page)).toMatch(/^\/v\//);

    await page.goto('/');
    const meet = id(page, 'WEB-03.event').first();
    await expect(meet).toBeVisible();
    await meet.click();
    await expect(id(page, 'WEB-13.root')).toBeVisible();
    expect(pathOf(page)).toMatch(/^\/e\//);
  });

  test('WEB-13 shows a public meet, opens the app to answer and serves the calendar file', async ({ page }) => {
    await page.goto(`/e/${HAFEN}`);
    await expect(id(page, 'WEB-13.title')).toHaveText('Abendtreffen am Hafen');
    await expect(id(page, 'WEB-13.venue')).toBeVisible();
    await expect(id(page, 'WEB-13.sample').first()).toBeVisible();

    const bar = id(page, 'WEB-13.stickyBar');
    const open = bar.locator('[data-testid="WEB-01.openInApp"]');
    await expect(open).toHaveText('In der App zusagen');
    await expect(open).toHaveAttribute('href', `${BASE_URL}/app/events/${HAFEN}`);
    await expect(open).toHaveAttribute('data-deep-link', `speedclub://events/${HAFEN}`);

    const calendar = await page.request.get((await id(page, 'WEB-13.calendar').getAttribute('href')) ?? '');
    expect(calendar.status()).toBe(200);
    expect(calendar.headers()['content-type']).toContain('text/calendar');

    // A tap leaves for openstreetmap.org in a new tab; nothing on the page loads from there.
    for (const link of ['WEB-13.map', 'WEB-13.route']) {
      await expect(id(page, link)).toHaveAttribute('href', /^https:\/\/www\.openstreetmap\.org\//);
      await expect(id(page, link)).toHaveAttribute('target', '_blank');
      await expect(id(page, link)).toHaveAttribute('rel', /noopener/);
    }
  });

  test('WEB-13 keeps the place of an after_rsvp meet to the city, in the page and its structured data', async ({ page }) => {
    await page.goto(`/e/${PRIVATE}`);
    await expect(id(page, 'WEB-13.afterRsvp')).toBeVisible();
    await expect(id(page, 'WEB-13.city')).toHaveText('München');
    await expect(page.locator('[data-testid="WEB-13.route"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="WEB-13.address"]')).toHaveCount(0);

    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    const event = jsonLd.map((text) => JSON.parse(text) as { '@type': string; location?: { address?: Record<string, string> } }).find((block) => block['@type'] === 'Event');
    expect(event?.location?.address?.addressLocality).toBe('München');
    expect(event?.location?.address?.streetAddress).toBeUndefined();
  });

  test('a meet a guest may not see answers the 404 page', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 404, url: /\/e\/gibt-es-nicht$/ }]);
    const response = await page.goto('/e/gibt-es-nicht');
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="WEB-STATE.root"][data-state="event_unavailable"]')).toBeVisible();
  });

  test('WEB-02 lists the garage as VehicleCards 2.0 that open the build', async ({ page }) => {
    await page.goto('/u/lukas.sc');
    await expect(id(page, 'WEB-02.name')).toBeVisible();
    const card = id(page, 'WEB-02.vehicle').first();
    await expect(card.locator('[data-testid="WEB-02.vehicle.spec"]')).toBeVisible();
    await card.click();
    await expect(id(page, 'WEB-01.root')).toBeVisible();
  });

  // DQ-1237 and the M4.18 LCP fix: the cover is a member page's one eager photo (ADR-469) and every garage card is deferred, the first
  // included, although at 412 × 915 (Pixel 8) jann.ptrs's first card reaches into the first viewport. The cards must come right after
  // the cover's LCP entry (resources/js/public/app.ts deferredPhotos), not on the 2.5 s fallback, and only once the cover has arrived
  // (M4.16 LCP rule).
  test('WEB-02 at phone width loads the garage photos below the fold after the first viewport, without the 2.5 s fallback', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    // Timed here, not in the page: the test context's fixed clock (makeContextDeterministic) also stands in for `performance`.
    type Swap = { coverArrived: boolean; garageDeferred: boolean };
    const marks: { load?: number; swap?: number } & Partial<Swap> = {};
    await page.exposeFunction('scMark', (what: 'load' | 'swap', state?: Swap) => {
      marks[what] ??= Date.now();
      if (what === 'swap' && state) Object.assign(marks, state);
    });
    await page.addInitScript(() => {
      const mark = (what: 'load' | 'swap', state?: { coverArrived: boolean; garageDeferred: boolean }): void =>
        void (window as unknown as { scMark: (what: string, state?: object) => Promise<void> }).scMark(what, state);
      window.addEventListener('load', () => mark('load'), { once: true });
      new MutationObserver((records, observer) => {
        // swap() renames every deferred photo in one go, so one batch names them all; the cover is not among them.
        const swapped = new Set(records.filter((record) => record.attributeName === 'data-sc-src').map((record) => record.target));
        if (swapped.size === 0) return;
        observer.disconnect();
        const [cover, ...others] = [...document.querySelectorAll<HTMLImageElement>('img[fetchpriority="high"]')];
        const garage = [...document.querySelectorAll<HTMLImageElement>('.sc-prof-garage img')];
        mark('swap', {
          coverArrived: cover !== undefined && others.length === 0 && !swapped.has(cover) && cover.complete && cover.naturalWidth > 0,
          garageDeferred: garage.length >= 2 && garage.every((img) => swapped.has(img)),
        });
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-sc-src'] });
    });
    await page.goto('/u/jann.ptrs');
    await expect(id(page, 'WEB-02.cover')).toBeVisible();
    await expect.poll(() => marks.swap, { message: 'the deferred photos were swapped in', timeout: 10_000 }).toBeDefined();
    await expect.poll(() => marks.load, { message: 'the load event' }).toBeDefined();
    expect(marks.coverArrived, 'the cover, the one eager photo, had arrived before the swap').toBe(true);
    expect(marks.garageDeferred, 'every garage card, the first included, came in the swap').toBe(true);
    // The fallback would come 2,500 ms after load; the LCP path comes within a few frames of it.
    expect((marks.swap ?? Infinity) - (marks.load ?? -Infinity), 'ms from the load event to the swap').toBeLessThan(1500);
  });

  test('every page reads without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    for (const [path, root] of [['/', 'WEB-03.root'], [`/e/${HAFEN}`, 'WEB-13.title'], ['/u/lukas.sc', 'WEB-02.name']] as const) {
      await page.goto(`${BASE_URL}${path}`);
      await expect(page.locator(`[data-testid="${root}"]`).first()).toBeVisible();
    }
    await context.close();
  });

  for (const [label, width, fontScale] of [['360 px', 360, 1], ['200 % text', 390, 2]] as const) {
    test(`no public page scrolls sideways at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/', `/e/${HAFEN}`, `/e/${PRIVATE}`, '/u/lukas.sc']) {
        await page.goto(qaUrl(path, { fontScale }));
        await expectNoSidewaysScroll(page);
      }
    });
  }
});
