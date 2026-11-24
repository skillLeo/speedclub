// R4-1.1 (docs/11_CLIENT_ROUND_4.md): on a phone the section index of VEH-01 (Überblick · Daten · Mods · Pläne · Verlauf · Galerie)
// "moves around and doesn't stay in place" while scrolling. The pinned row was an overlay moved by a translate on every scroll event;
// mobile browsers scroll on the compositor and report late, so it lagged and jumped. Now the row scrolls natively in its list row,
// and a fixed copy takes over at the bar (one state flip at the threshold, nothing per frame).
//
// At 390 × 844 on a touch device: the list is scrolled in steps of 37 px. Each step reads the row's box at once (the same task as
// the scroll, before any scroll event can be handled) and again once the page rests. Before the pin the row moves 1:1 with the
// content; once pinned its top is the bar's bottom (±1 px), and both reads agree whenever the step did not cross the threshold.
// Exactly one element carries VEH-01.sections at any time.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { open } from '../support/flow';

const R34 = '/app/v/nissan-skyline-gt-r-r34-5tf974vj';
const STEP = 37;

type Read = { scroll: number; top: number | null; count: number };

/** Sets the scroller's offset and reads the row's top in the same task: what a reader sees in the frame of the scroll. */
function scrollAndRead(page: Page, offset: number): Promise<Read> {
  return page.evaluate((offset) => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="VEH-01.scroll"]');
    if (!scroller) throw new Error('VEH-01.scroll is missing');
    scroller.scrollTop = offset;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="VEH-01.sections"]')];
    const top = rows[0] ? rows[0].getBoundingClientRect().top : null;
    return { scroll: scroller.scrollTop, top, count: rows.length };
  }, offset);
}

/**
 * The row's top once the page has handled the scroll: two frames, then until three reads 50 ms apart agree (at most 2 s). The flip
 * at the threshold is a state change after the scroll event, which a loaded machine delivers a few frames later.
 */
function readAtRest(page: Page): Promise<Read> {
  return page.evaluate(async () => {
    const read = (): { scroll: number; top: number | null; count: number } => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="VEH-01.scroll"]');
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="VEH-01.sections"]')];
      return { scroll: scroller?.scrollTop ?? 0, top: rows[0] ? rows[0].getBoundingClientRect().top : null, count: rows.length };
    };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let last = read();
    let same = 0;
    for (let step = 0; step < 40 && same < 3; step++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const next = read();
      same = next.top === last.top && next.count === last.count && next.scroll === last.scroll ? same + 1 : 0;
      last = next;
    }
    return last;
  });
}

test.describe('R4-1.1 VEH-01 section index on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });

  test('the row scrolls 1:1 with the content, then stays under the bar without moving', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, R34);
    await page.locator('[data-testid="VEH-01.body.settled"] [data-testid="VEH-01.section.overview"]').first().waitFor({ timeout: 30_000 });
    const sections = page.locator('[data-testid="VEH-01.sections"]');
    await expect(sections).toHaveCount(1);

    const header = page.locator('[data-testid="VEH-01.header"]:visible').first();
    const bar = await header.boundingBox();
    if (!bar) throw new Error('VEH-01.header has no box');
    const barBottom = bar.y + bar.height;

    const start = await readAtRest(page);
    expect(start.top, 'the row is drawn').not.toBeNull();
    const naturalTop = start.top as number;
    // The offset at which the row reaches the bar.
    const threshold = naturalTop - barBottom;
    expect(threshold, 'the row starts below the bar').toBeGreaterThan(0);
    const end = threshold + 30 * STEP;

    let wasPinned = false;
    let pinnedSteps = 0;
    for (let offset = STEP; offset <= end; offset += STEP) {
      const now = await scrollAndRead(page, offset);
      const rest = await readAtRest(page);
      expect(now.count, `one VEH-01.sections at ${offset}`).toBe(1);
      expect(rest.count, `one VEH-01.sections at rest at ${offset}`).toBe(1);
      const scroll = rest.scroll;
      const pinned = scroll >= threshold;
      const expected = pinned ? barBottom : naturalTop - scroll;
      expect(Math.abs((rest.top as number) - expected), `row top at rest, offset ${scroll}`).toBeLessThanOrEqual(1);
      // In the frame of the scroll itself: no lag. Only a step across the threshold may need the flip first.
      if (pinned === wasPinned) {
        expect(Math.abs((now.top as number) - expected), `row top in the scroll's own frame, offset ${now.scroll}`).toBeLessThanOrEqual(1);
      }
      if (pinned) pinnedSteps += 1;
      wasPinned = pinned;
    }
    expect(pinnedSteps, 'the page scrolled far enough to pin the row').toBeGreaterThan(10);

    // And back up: the row leaves the bar with the content again.
    for (let offset = Math.floor(threshold - STEP); offset >= 0; offset -= STEP * 3) {
      await scrollAndRead(page, offset);
      const rest = await readAtRest(page);
      expect(rest.count).toBe(1);
      expect(Math.abs((rest.top as number) - (naturalTop - rest.scroll)), `row top on the way up, offset ${rest.scroll}`).toBeLessThanOrEqual(1);
    }
  });
});
