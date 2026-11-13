// BUG-5 (M4.8): the owner's Android phone drew the "Beliebte Mods" chip row on Start and Entdecken as one giant pill over the page,
// and Start ended in "This screen couldn't load" while scrolling. Prime suspect: the chip row measured every chip and set state from
// the layouts (a render loop under a recycled list cell or a hidden screen). The row now decides its cut before the first paint.
//
// Regression, on the member web at the owner's phone sizes (360 and 412 wide, DPR 2.625, a touch device), signed in as the demo
// member and as a guest: scroll Start and Entdecken to the end and back. No route error screen, no page error, and every chip of the
// row is a chip (at most 48 high, never wider than the window).
import type { Locator, Page } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { qaUrl } from '../support/qa.mjs';

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
/** 48: a chip at 200 % is 42 (a callout line of 40 and the border); anything taller is not a chip any more. */
const CHIP_MAX_HEIGHT = 48;

/** Every chip of the Beliebte Mods row drawn now: its box. */
function chipBoxes(page: Page, prefix: string): Promise<{ width: number; height: number }[]> {
  return page.evaluate(
    (prefix) =>
      [...document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}.chip."]`)]
        .filter((el) => el.checkVisibility())
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { width: Math.round(box.width), height: Math.round(box.height) };
        }),
    prefix,
  );
}

/** The scroll offset of the list `listId` once it rests. */
function offsetOf(list: Locator): Promise<{ top: number; max: number }> {
  return list.evaluate(async (root) => {
    const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight;
    let found: Element | null = scrolls(root) ? root : ([...root.querySelectorAll('*')].find(scrolls) ?? null);
    for (let up = root.parentElement; !found && up; up = up.parentElement) if (scrolls(up)) found = up;
    const scroller = found ?? document.scrollingElement ?? document.documentElement;
    let last = -1;
    for (let read = 0; read < 40 && scroller.scrollTop !== last; read++) {
      last = scroller.scrollTop;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight };
  });
}

/**
 * Wheels the list to its end (loading further pages on the way) and back to the top, checking the chips and the error screen at every
 * step. Returns the tallest chip seen.
 */
async function scrollThrough(page: Page, listId: string, chips: string): Promise<{ tallest: number; widest: number; steps: number }> {
  const list = id(page, listId);
  const box = await list.boundingBox();
  if (!box) throw new Error(`${listId} is not on screen`);
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, Math.min(box.y + box.height, viewport.height) / 2);
  let tallest = 0;
  let widest = 0;
  let steps = 0;
  const check = async () => {
    await expect(page.locator('[data-testid="shell.routeError"]')).toHaveCount(0);
    for (const chip of await chipBoxes(page, chips)) {
      tallest = Math.max(tallest, chip.height);
      widest = Math.max(widest, chip.width);
    }
  };
  // Down: until the offset stops growing at its end three times in a row (a next page may arrive and extend the list).
  let still = 0;
  let previous = -1;
  for (let step = 0; step < 120 && still < 3; step++) {
    await page.mouse.wheel(0, 900);
    const { top, max } = await offsetOf(list);
    steps += 1;
    await check();
    still = top >= max - 2 && top === previous ? still + 1 : 0;
    previous = top;
  }
  expect(still, `${listId} reached its end`).toBeGreaterThanOrEqual(3);
  // And back up to the top.
  for (let step = 0; step < 120; step++) {
    await page.mouse.wheel(0, -1200);
    const { top } = await offsetOf(list);
    await check();
    if (top <= 0) break;
  }
  expect((await offsetOf(list)).top, `${listId} is back at its top`).toBe(0);
  return { tallest, widest, steps };
}

for (const width of [360, 412]) {
  for (const who of ['guest', 'member'] as const) {
    test.describe(`BUG-5 at ${width} as a ${who}`, () => {
      test.use({ viewport: { width, height: Math.round(width * 2.22) }, deviceScaleFactor: 2.625, hasTouch: true });

      test.beforeEach(async ({ context }) => {
        if (who === 'member') await applyAuth(context, 'member');
      });

      test('Start scrolls to its end and back without an error screen, and the Beliebte Mods chips stay chips', async ({ page, pageErrors }) => {
        test.setTimeout(240_000);
        await page.goto(qaUrl('/app/'));
        await expect(id(page, 'HOME-01.featured')).toBeVisible();
        const seen = await scrollThrough(page, 'HOME-01.list', 'HOME-01.mods.list');
        expect(seen.tallest, 'a Beliebte Mods chip was drawn on the way').toBeGreaterThan(0);
        expect(seen.tallest, 'no chip is taller than a chip').toBeLessThanOrEqual(CHIP_MAX_HEIGHT);
        expect(seen.widest, 'no chip is wider than the window').toBeLessThanOrEqual(width);
        expect(pageErrors).toEqual([]);
      });

      test('Entdecken scrolls to its end and back without an error screen, and the Beliebte Mods chips stay chips', async ({ page, pageErrors }) => {
        test.setTimeout(240_000);
        await page.goto(qaUrl('/app/discover'));
        await expect(id(page, 'DISC-01.root')).toBeVisible();
        const seen = await scrollThrough(page, 'DISC-01.list', 'DISC-01.popularMods');
        expect(seen.tallest, 'no chip is taller than a chip').toBeLessThanOrEqual(CHIP_MAX_HEIGHT);
        expect(seen.widest, 'no chip is wider than the window').toBeLessThanOrEqual(width);
        expect(pageErrors).toEqual([]);
      });
    });
  }
}
