// Blade-vs-SPA parity, docs/07_QA_AND_RELEASE.md section 3: the public vehicle page /v/{demo} (WEB-01, server-rendered)
// and the app's /app/v/{demo} (VEH-01) at 390 × carbon × de show the same texts in the same order in the hero, the title
// block, the spec strip and the owner row, and each of those regions differs in at most 3 % of its pixels. Both as a
// guest: a signed-in member is redirected from /v to /app/v (ADR-148 i). Chromium and WebKit render both sides the same
// way, so the comparison runs in each engine.
import { expect, test, watchPageErrors } from '../support/fixtures';
import { R34 } from '../support/garage.mjs';
import { contextOptions, makeContextDeterministic, qaUrl, waitForStablePage } from '../support/qa.mjs';
import { compareParity, MAX_REGION_DIFF, VEHICLE_REGIONS } from './compare.mjs';

const QA = { theme: 'carbon', locale: 'de' } as const;

test('/v/{demo} and /app/v/{demo} match in hero, title, spec strip and owner row (390, carbon, de)', async ({ browser, qaGoto, page, pageErrors }) => {
  // The Blade page in a context of its own, with the same deterministic clock and no third parties as the fixture's.
  await page.setViewportSize({ width: 390, height: 844 });
  await qaGoto(`/app/v/${R34.slug}`, QA);
  await expect(page.locator('[data-testid="VEH-01.title"]:visible')).toHaveText('Skyline GT-R R34');
  await expect(page.locator('[data-testid="VEH-01.hero"]:visible img').first()).toBeVisible();

  const bladeContext = await browser.newContext(contextOptions({ theme: 'carbon', locale: 'de', viewport: { width: 390, height: 844 } }));
  try {
    await makeContextDeterministic(bladeContext);
    const blade = await bladeContext.newPage();
    watchPageErrors(blade, pageErrors);
    const response = await blade.goto(qaUrl(`/v/${R34.slug}`, QA));
    expect(response?.status()).toBe(200);
    await expect(blade.locator('[data-testid="WEB-01.root"]')).toBeVisible();
    await waitForStablePage(blade);
    expect(await blade.evaluate(() => document.documentElement.dataset.qaTheme)).toBe('carbon');
    expect(await page.evaluate(() => document.documentElement.dataset.qaTheme)).toBe('carbon');

    const result = await compareParity(blade, page);
    const report = result.regions
      .map((r) => `${r.testId}: texts ${r.textsEqual ? 'equal' : `differ (${r.textDifference})`}, pixels ${(r.pixelDiff * 100).toFixed(2)} %, same size ${r.sameSize}`)
      .join('\n');
    expect(result.regions.map((r) => r.testId)).toEqual(VEHICLE_REGIONS);
    for (const region of result.regions) {
      expect(region.textsEqual, `${region.testId} texts\n${report}`).toBe(true);
      expect(region.pixelDiff, `${region.testId} pixels (at most ${MAX_REGION_DIFF * 100} %)\n${report}`).toBeLessThanOrEqual(MAX_REGION_DIFF);
    }
    expect(result.passed, report).toBe(true);
  } finally {
    await bladeContext.close();
  }
});
