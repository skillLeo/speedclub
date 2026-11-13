// M4.4 design QA round 3 evidence (opt-in: M44_SHOTS=1), the cells docs/reports/design-qa/phase-4/2026-11-12-M4.4.md asks for:
// VEH-01-history (390, 390 fs2, 1280; Carbon + Hell), DEV-01-cards (390, 390 fs2, 1280; both), DEV-01-buttons 390 and
// DEV-01-overlays 390 (both). JPEG, DSF 1, the inner scroller expanded as the visual harness does, into
// docs/reports/phase-4/m4.4-shots-r3/.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { qaUrl, waitForStablePage } from '../support/qa.mjs';

const OUT = fileURLToPath(new URL('../../../../docs/reports/phase-4/m4.4-shots-r3/', import.meta.url));
const MAX_HEIGHT = 12_000;

type Cell = { width: number; height: number; fontScale: 1 | 2 };
const PHONE: Cell = { width: 390, height: 844, fontScale: 1 };
const PHONE_FS2: Cell = { width: 390, height: 844, fontScale: 2 };
const DESKTOP: Cell = { width: 1280, height: 800, fontScale: 1 };

const ROUTES: { id: string; path: string; ready: string; cells: Cell[] }[] = [
  { id: 'VEH-01-history', path: '/app/v/nissan-skyline-gt-r-r34-5tf974vj?tab=history', ready: 'VEH-01.title', cells: [PHONE, PHONE_FS2, DESKTOP] },
  { id: 'DEV-01-cards', path: '/app/dev/gallery/cards', ready: 'DEV-01.cards.root', cells: [PHONE, PHONE_FS2, DESKTOP] },
  { id: 'DEV-01-buttons', path: '/app/dev/gallery/buttons', ready: 'DEV-01.buttons.root', cells: [PHONE] },
  { id: 'DEV-01-overlays', path: '/app/dev/gallery/overlays', ready: 'DEV-01.overlays.root', cells: [PHONE] },
];

/** The inner scroller's overflow becomes window height, so one picture holds the page (visual/run.mjs expandToInnerScroller). */
async function expand(page: Page, cell: Cell): Promise<void> {
  const extra = await page.evaluate(() => {
    let max = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.checkVisibility()) max = Math.max(max, el.scrollHeight - el.clientHeight);
    }
    return max;
  });
  if (extra > 0) await page.setViewportSize({ width: cell.width, height: Math.min(cell.height + extra, MAX_HEIGHT) });
}

test.describe('M4.4 round 3 evidence', () => {
  test.skip(!process.env.M44_SHOTS, 'Opt-in: M44_SHOTS=1.');
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  for (const route of ROUTES) {
    for (const cell of route.cells) {
      for (const theme of ['carbon', 'light'] as const) {
        const name = `${route.id}.${cell.width}.${theme}${cell.fontScale === 2 ? '.fs2' : ''}`;
        test(name, async ({ page }) => {
          test.setTimeout(120_000);
          await page.setViewportSize({ width: cell.width, height: cell.height });
          await page.goto(qaUrl(route.path, { theme, fontScale: cell.fontScale }));
          await expect(page.locator(`[data-testid="${route.ready}"]:visible`).first()).toBeVisible();
          await waitForStablePage(page);
          await expand(page, cell);
          await waitForStablePage(page);
          await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 85, animations: 'disabled', caret: 'hide' });
        });
      }
    }
  }
});
