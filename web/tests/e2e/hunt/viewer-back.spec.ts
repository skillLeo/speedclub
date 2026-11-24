// BL-25 (QA H1): on the member web the browser's back button or gesture closes an open photo viewer first and keeps the page;
// the next back leaves the page as before. Also the viewer's own close button must not leave an extra history entry behind.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { id, open, pathOf } from '../support/flow';

/** A public build with photos in the seed (the R34 of r5-gallery-swipe). */
const R34 = '/app/v/nissan-skyline-gt-r-r34-5tf974vj';

async function openViewer(page: Page): Promise<void> {
  const hero = id(page, 'VEH-01.hero').first();
  await expect(hero).toBeVisible();
  const box = await hero.boundingBox();
  if (!box) throw new Error('VEH-01.hero has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(id(page, 'VEH-04.viewer.counter')).toBeVisible();
}

test.describe('BL-25 browser back and the photo viewer', () => {
  test('back closes the viewer and stays on the build; the next back leaves it', async ({ page }) => {
    await open(page, '/app/discover');
    await expect(page.locator('#root')).toBeVisible();
    await open(page, R34);
    await openViewer(page);

    await page.goBack();
    await expect(id(page, 'VEH-04.viewer.counter')).toHaveCount(0);
    expect(pathOf(page)).toBe(R34);
    await expect(id(page, 'VEH-01.hero').first()).toBeVisible();

    await page.goBack();
    await expect.poll(() => pathOf(page)).not.toBe(R34);
    await page.waitForLoadState('networkidle');
  });

  test('closing with the button leaves no extra entry: one back leaves the build', async ({ page }) => {
    await open(page, '/app/discover');
    await expect(page.locator('#root')).toBeVisible();
    await open(page, R34);
    await openViewer(page);
    await id(page, 'VEH-04.viewer.close').click();
    await expect(id(page, 'VEH-04.viewer.counter')).toHaveCount(0);
    expect(pathOf(page)).toBe(R34);
    // Open and close twice more: still exactly one entry for the build.
    await openViewer(page);
    await page.keyboard.press('Escape');
    await expect(id(page, 'VEH-04.viewer.counter')).toHaveCount(0);

    await page.goBack();
    await expect.poll(() => pathOf(page)).not.toBe(R34);
    // Let the screen it went back to finish loading its code before the test closes the page.
    await page.waitForLoadState('networkidle');
  });
});
