// Blade-vs-SPA parity, docs/07_QA_AND_RELEASE.md section 3: same texts in the same order for
// hero, title, spec strip and owner row, pixel diff of those regions at most 3 %.
import { comparePng } from '../support/image-diff.mjs';

export const MAX_REGION_DIFF = 0.03;
export const VEHICLE_REGIONS = ['VEH-01.hero', 'VEH-01.title', 'VEH-01.specStrip', 'VEH-01.ownerRow'];
/** The floating controls over VEH-01's hero: the app's photo header (back, save, share, more) and WEB-01's save chip. */
export const VEHICLE_HERO_CHROME = ['[data-testid="VEH-01.header"]', '[data-testid="VEH-01.save"]'];

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
 * @param {{regions?:string[],maxDiff?:number,chrome?:string[]}} [opts] `chrome`: selectors of floating controls hidden on both sides during capture
 * @returns {Promise<{passed:boolean,regions:{testId:string,textsEqual:boolean,textDifference:string|null,pixelDiff:number,pixelsOk:boolean,sameSize:boolean,occludedBy:string[]}[]}>}
 */
export async function compareParity(blade, spa, { regions = VEHICLE_REGIONS, maxDiff = MAX_REGION_DIFF, chrome = [] } = {}) {
  // Floating controls over a photo are chrome, not the region's content (SKILL rule 2), and the two sides place them
  // differently (the app floats back, save, share and more over its hero; the public page has its top bar above it and one
  // save chip). They are hidden on both sides while a region is captured, so the region's own pixels are compared.
  // Through the CSSOM, which a strict style-src (the public pages' nonce CSP) allows, where an injected style element is refused.
  const setChrome = (/** @type {import('@playwright/test').Page} */ page, /** @type {boolean} */ hidden) =>
    chrome.length === 0
      ? Promise.resolve()
      : page.evaluate(
          ({ selectors, hide }) => {
            for (const el of document.querySelectorAll(selectors.join(', '))) {
              if (el instanceof HTMLElement || el instanceof SVGElement) el.style.visibility = hide ? 'hidden' : '';
            }
          },
          { selectors: chrome, hide: hidden },
        );
  const results = [];
  for (const testId of regions) {
    const texts = compareTexts(await regionTexts(blade, testId), await regionTexts(spa, testId));
    const shot = async (/** @type {import('@playwright/test').Page} */ page) => {
      const region = page.locator(`[data-testid="${testId}"]:visible`).first();
      const occludedBy = await revealRegion(region);
      await setChrome(page, true);
      const png = await region.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }).finally(() => setChrome(page, false));
      return { png, occludedBy };
    };
    const bladeShot = await shot(blade);
    const spaShot = await shot(spa);
    const pixels = comparePng(bladeShot.png, spaShot.png, { writeDiff: false });
    const occludedBy = [...bladeShot.occludedBy.map((o) => `blade: ${o}`), ...spaShot.occludedBy.map((o) => `app: ${o}`)];
    results.push({
      testId,
      textsEqual: texts.equal,
      textDifference: texts.difference,
      pixelDiff: pixels.ratio,
      pixelsOk: pixels.ratio <= maxDiff,
      sameSize: pixels.sameSize,
      occludedBy,
    });
  }
  return { passed: results.every((r) => r.textsEqual && r.pixelsOk && r.occludedBy.length === 0), regions: results };
}

/**
 * An element screenshot captures whatever is painted over the region, so a sticky bar or a tab bar that covers it (WEB-01's
 * sticky CTA bar over the owner row at 844 high once SpecStrip 2.0 grew the strip) would be compared as if it were the region.
 * The region is scrolled to the middle of its scroller first, then its edges are hit-tested: what still covers them is returned,
 * so the comparison fails with a reason instead of comparing chrome.
 * @param {import('@playwright/test').Locator} region
 * @returns {Promise<string[]>}
 */
async function revealRegion(region) {
  return region.evaluate((root) => {
    root.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = root.getBoundingClientRect();
    const inset = 2;
    const xs = [box.left + inset, box.left + box.width / 2, box.right - inset];
    const ys = [box.top + inset, box.top + box.height / 2, box.bottom - inset];
    const covering = new Set();
    for (const x of xs) {
      for (const y of ys) {
        const hit = document.elementFromPoint(x, y);
        // An ancestor answers where the region lets pointer events through (RN web box-none): it is behind, not over the region.
        if (hit && hit !== root && !root.contains(hit) && !hit.contains(root)) {
          const id = hit.closest('[data-testid]')?.getAttribute('data-testid');
          covering.add(id ?? `${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? `.${hit.className.split(' ')[0]}` : ''}`);
        }
      }
    }
    return [...covering];
  });
}
