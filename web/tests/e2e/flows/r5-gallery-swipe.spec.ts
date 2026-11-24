// R5-2d (docs/12_CLIENT_ROUND_5.md): "image swiping bug" in the vehicle gallery and viewer. Reproduced on the member web
// (docs/reports/round-5/gallery-swipe.md):
// - VEH-04: two swipes within half a second counted as a double tap (RNGH's tap has no distance limit by default), so the photo
//   zoomed to 2× and the next swipe panned it instead of paging; two quick pans of a zoomed photo reset its zoom.
// - VEH-01 hero: CSS scroll snap stopped a fling only at the end (`scroll-snap-stop: normal`): a 300 px flick went from 1/3 to 3/3.
//
// Two phones with touch: Pixel 7 on Chromium, with real touch through CDP (`Input.dispatchTouchEvent`, the browser's own touch
// scrolling and fling), and iPhone 15 on WebKit, where Playwright can only tap: there a drag is the mouse (the hero's mouse paging
// and RNGH's pointer handling, the same code a finger reaches in Safari), and what needs the browser's touch scrolling is skipped.
import { devices, type CDPSession, type Locator, type Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { open } from '../support/flow';
import { QA_NOW } from '../support/qa.mjs';

/** A public build with three photos in the seed. */
const R34 = '/app/v/nissan-skyline-gt-r-r34-5tf974vj';
const PHOTOS = 3;

type Phone = { name: string; engine: 'chromium' | 'webkit'; descriptor: (typeof devices)[string] };
const PHONES: Phone[] = [
  { name: 'Pixel 7', engine: 'chromium', descriptor: devices['Pixel 7'] },
  { name: 'iPhone 15', engine: 'webkit', descriptor: devices['iPhone 15'] },
];

const visible = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`).first();

type Hero = { left: number; width: number; counter: string | null; pageTop: number };

/** The hero pager's offset, the counter, and the page's own scroll offset. */
function readHero(page: Page): Promise<Hero> {
  return page.evaluate(() => {
    const hero = document.querySelector('[data-testid="VEH-01.hero"]');
    const pager = hero ? [...hero.querySelectorAll<HTMLElement>('*')].find((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX)) : undefined;
    const root = document.querySelector('[data-testid="VEH-01.scroll"]');
    const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight;
    const scroller = root ? [root, ...root.querySelectorAll('*')].find(scrolls) : undefined;
    return {
      left: Math.round(pager?.scrollLeft ?? -1),
      width: pager?.clientWidth ?? 0,
      counter: document.querySelector('[data-testid="VEH-01.photoCount"]')?.textContent ?? null,
      pageTop: Math.round(scroller?.scrollTop ?? 0),
    };
  });
}

/** Reads until three reads 100 ms apart agree: the pager has stopped gliding. */
async function heroAtRest(page: Page): Promise<Hero> {
  let last = await readHero(page);
  for (let same = 0, step = 0; same < 2 && step < 40; step++) {
    await page.waitForTimeout(100);
    const next = await readHero(page);
    same = JSON.stringify(next) === JSON.stringify(last) ? same + 1 : 0;
    last = next;
  }
  return last;
}

type Viewer = { counter: string | null; zoom: string };

/** The viewer's counter and the zoom of the photo on screen (`none` or an identity matrix when not zoomed). */
function readViewer(page: Page): Promise<Viewer> {
  return page.evaluate(() => {
    const track = document.querySelector('[data-testid="VEH-04.viewer.stage"]')?.firstElementChild;
    const zooms = track ? [...track.children].map((slide) => getComputedStyle(slide.firstElementChild ?? slide).transform) : [];
    const scale = (transform: string) => (transform === 'none' ? 1 : Number(/matrix\(([-\d.e]+)/.exec(transform)?.[1] ?? 1));
    return {
      counter: document.querySelector('[data-testid="VEH-04.viewer.counter"]')?.textContent ?? null,
      zoom: String(Math.max(1, ...zooms.map(scale))),
    };
  });
}

/** A one-finger drag: real touch through CDP on Chromium, the mouse on WebKit. */
async function drag(
  page: Page,
  cdp: CDPSession | null,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
  /** A pause before the finger lifts, so the release carries no speed (a drag, not a flick). */
  holdMs = 0,
): Promise<void> {
  const at = (i: number) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(16);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] });
    }
    if (holdMs > 0) await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(16);
    await page.mouse.move(at(i).x, at(i).y);
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

async function openBuild(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  await open(page, R34);
  const hero = visible(page, 'VEH-01.hero');
  await expect(visible(page, 'VEH-01.photoCount')).toHaveText(`1/${PHOTOS}`, { timeout: 30_000 });
  const box = await hero.boundingBox();
  if (!box) throw new Error('VEH-01.hero has no box');
  return box;
}

for (const phone of PHONES) {
  const { defaultBrowserType: _engine, ...descriptor } = phone.descriptor;

  test.describe(`R5-2d gallery swipe on ${phone.name}`, () => {
    test.skip(({ browserName }) => browserName !== phone.engine, `${phone.name} runs on ${phone.engine}`);
    test.use({ ...descriptor, hasTouch: true, isMobile: true });

    let cdp: CDPSession | null = null;
    test.beforeEach(async ({ page }) => {
      // The fixture fixes Date.now (clock.setFixedTime). A pager needs time to pass: react-native-web throttles `onScroll` by
      // Date.now, so the counter heard only the first scroll tick, and the hero's swipe-tap guard never ran out. The same date,
      // flowing (setSystemTime clears the fixed time and keeps the date of the run).
      await page.clock.setSystemTime(new Date(QA_NOW));
      cdp = phone.engine === 'chromium' ? await page.context().newCDPSession(page) : null;
    });

    test('the hero snaps to one photo per swipe, the counter follows, and a tap opens the photo on screen', async ({ page }) => {
      const box = await openBuild(page);
      const y = box.y + box.height / 2;
      const left = { x: box.x + box.width * 0.2, y };
      const right = { x: box.x + box.width * 0.8, y };

      await drag(page, cdp, right, left);
      let hero = await heroAtRest(page);
      expect(hero.left, 'a swipe to the left lands on photo 2').toBe(hero.width);
      expect(hero.counter).toBe(`2/${PHOTOS}`);

      await drag(page, cdp, right, left);
      hero = await heroAtRest(page);
      expect(hero.left).toBe(2 * hero.width);
      expect(hero.counter).toBe(`3/${PHOTOS}`);

      await drag(page, cdp, left, right);
      hero = await heroAtRest(page);
      expect(hero.left, 'and back to photo 2').toBe(hero.width);
      expect(hero.counter).toBe(`2/${PHOTOS}`);

      // A short drag, held before the finger lifts, snaps back to the photo it started on.
      await drag(page, cdp, { x: box.x + box.width * 0.6, y }, { x: box.x + box.width * 0.5, y }, 6, 300);
      hero = await heroAtRest(page);
      expect(hero.left, 'a short drag snaps back').toBe(hero.width);
      expect(hero.counter).toBe(`2/${PHOTOS}`);

      // The photo opened is the photo the counter shows. On WebKit the drags were the mouse, and the hero swallows a click within
      // 350 ms of a mouse drag (CF-5, the click that ends a drag): the tap comes after that.
      await page.waitForTimeout(400);
      await page.touchscreen.tap(box.x + box.width / 2, y);
      await expect(visible(page, 'VEH-04.viewer.counter')).toHaveText(`2/${PHOTOS}`);
    });

    test('a fling stops at the next photo', async ({ page }) => {
      const box = await openBuild(page);
      // Every slide is a snap area that a fling cannot pass (both engines).
      const stops = await page.evaluate(() => {
        const hero = document.querySelector('[data-testid="VEH-01.hero"]');
        const slides = hero ? [...hero.querySelectorAll<HTMLElement>('*')].filter((el) => getComputedStyle(el).scrollSnapAlign.includes('start')) : [];
        return slides.map((el) => getComputedStyle(el).scrollSnapStop);
      });
      expect(stops.filter((stop) => stop === 'always').length, 'each photo stops a fling').toBe(PHOTOS);
      if (!cdp) {
        test.info().annotations.push({ type: 'note', description: 'WebKit: Playwright has no touch fling; the snap stops are checked' });
        return;
      }
      // A fast flick of 300 px: the browser's own fling, as a finger gives it on Android Chrome.
      await cdp.send('Input.synthesizeScrollGesture', {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
        xDistance: -300,
        yDistance: 0,
        speed: 3000,
        gestureSourceType: 'touch',
      });
      const hero = await heroAtRest(page);
      expect(hero.counter, 'the fling did not skip photo 2').toBe(`2/${PHOTOS}`);
      expect(hero.left).toBe(hero.width);
    });

    test('a vertical swipe on the hero scrolls the page, a sideways one does not', async ({ page }) => {
      test.skip(!cdp, 'WebKit: Playwright cannot drive the browser\'s touch scrolling');
      const box = await openBuild(page);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      // Sideways with a little slant: the pager moves, the page stays.
      await drag(page, cdp, { x: box.x + box.width * 0.8, y }, { x: box.x + box.width * 0.2, y: y + 30 });
      let hero = await heroAtRest(page);
      expect(hero.counter).toBe(`2/${PHOTOS}`);
      expect(hero.pageTop, 'a sideways swipe does not scroll the page').toBe(0);
      // Upwards from the hero: the page scrolls, the pager stays on its photo.
      await drag(page, cdp, { x, y: y + 60 }, { x, y: y - 200 });
      hero = await heroAtRest(page);
      expect(hero.pageTop, 'a vertical swipe on the hero scrolls the page').toBeGreaterThan(100);
      expect(hero.counter).toBe(`2/${PHOTOS}`);
      expect(hero.left).toBe(hero.width);
    });

    test('the viewer pages on quick swipes and never zooms on them', async ({ page }) => {
      const box = await openBuild(page);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(visible(page, 'VEH-04.viewer.counter')).toHaveText(`1/${PHOTOS}`);
      const stage = await visible(page, 'VEH-04.viewer.stage').boundingBox();
      if (!stage) throw new Error('VEH-04.viewer.stage has no box');
      const y = stage.y + stage.height / 2;
      const left = { x: stage.x + stage.width * 0.15, y };
      const right = { x: stage.x + stage.width * 0.85, y };

      // Back to back, well within the double tap's 500 ms: each swipe pages, none counts as a tap.
      const seen: Viewer[] = [];
      for (const [from, to] of [[right, left], [right, left], [left, right], [left, right], [right, left]] as const) {
        await drag(page, cdp, from, to, 5);
        await page.waitForTimeout(120);
        seen.push(await readViewer(page));
      }
      expect(seen.map((read) => read.counter)).toEqual([`2/${PHOTOS}`, `3/${PHOTOS}`, `2/${PHOTOS}`, `1/${PHOTOS}`, `2/${PHOTOS}`]);
      expect(seen.map((read) => read.zoom), 'no swipe zoomed the photo').toEqual(['1', '1', '1', '1', '1']);
    });
  });
}
