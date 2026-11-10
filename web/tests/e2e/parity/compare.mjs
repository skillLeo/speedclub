// Blade-vs-SPA parity, docs/07_QA_AND_RELEASE.md section 3: same texts in the same order for
// hero, title, spec strip and owner row, pixel diff of those regions at most 3 %.
import { comparePng } from '../support/image-diff.mjs';

export const MAX_REGION_DIFF = 0.03;
export const VEHICLE_REGIONS = ['VEH-01.hero', 'VEH-01.title', 'VEH-01.specStrip', 'VEH-01.ownerRow'];

/**
 * Rendered texts of a region in DOM order, as the user reads them: hidden text is left out and
 * CSS text-transform is applied, so `UPPERCASE` via CSS and via a string compare as equal.
 * @param {import('@playwright/test').Page} page
 * @param {string} testId
 * @returns {Promise<string[]>}
 */
export async function regionTexts(page, testId) {
  const region = page.locator(`[data-testid="${testId}"]:visible`).first();
  return region.evaluate((root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text || !parent || !parent.checkVisibility({ visibilityProperty: true })) continue;
      const transform = getComputedStyle(parent).textTransform;
      out.push(transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text);
    }
    return out;
  });
}

/**
 * Text runs can be split differently by the two renderers, so runs are joined before comparing.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{equal:boolean,difference:string|null}}
 */
export function compareTexts(a, b) {
  const left = a.join(' ');
  const right = b.join(' ');
  if (left === right) return { equal: true, difference: null };
  let i = 0;
  while (i < left.length && i < right.length && left[i] === right[i]) i++;
  return {
    equal: false,
    difference: `first difference at character ${i}: "${left.slice(Math.max(0, i - 20), i + 30)}" vs "${right.slice(Math.max(0, i - 20), i + 30)}"`,
  };
}

/**
 * @param {import('@playwright/test').Page} blade
 * @param {import('@playwright/test').Page} spa
 * @param {{regions?:string[],maxDiff?:number}} [opts]
 * @returns {Promise<{passed:boolean,regions:{testId:string,textsEqual:boolean,textDifference:string|null,pixelDiff:number,pixelsOk:boolean,sameSize:boolean}[]}>}
 */
export async function compareParity(blade, spa, { regions = VEHICLE_REGIONS, maxDiff = MAX_REGION_DIFF } = {}) {
  const results = [];
  for (const testId of regions) {
    const texts = compareTexts(await regionTexts(blade, testId), await regionTexts(spa, testId));
    const shot = (/** @type {import('@playwright/test').Page} */ page) =>
      page.locator(`[data-testid="${testId}"]:visible`).first().screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    const pixels = comparePng(await shot(blade), await shot(spa), { writeDiff: false });
    results.push({
      testId,
      textsEqual: texts.equal,
      textDifference: texts.difference,
      pixelDiff: pixels.ratio,
      pixelsOk: pixels.ratio <= maxDiff,
      sameSize: pixels.sameSize,
    });
  }
  return { passed: results.every((r) => r.textsEqual && r.pixelsOk), regions: results };
}
