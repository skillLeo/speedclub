// Tests the parity comparison itself. The spec for /v/{demo} vs /app/v/{demo} comes with M1.7.
import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { MAX_REGION_DIFF, compareParity, compareTexts, regionTexts } from './compare.mjs';

const REGIONS = ['r.title', 'r.spec'];

const html = (title: string, spec: string, css = ''): string => `<!doctype html><html lang="de"><head><style>
  body { margin: 0; background: #0b0b0c; color: #f5f5f3; font: 16px/24px sans-serif; }
  [data-testid="r.title"] { width: 390px; height: 48px; }
  [data-testid="r.spec"] { width: 390px; height: 100px; display: flex; gap: 16px; }
  ${css}
</style></head><body>
  <div data-testid="r.title">${title}</div>
  <div data-testid="r.spec">${spec}</div>
</body></html>`;

const SPEC = '<span>500 PS</span><span>540 Nm</span><span>2002</span>';

async function open(browser: Browser, content: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 300 } });
  const page = await context.newPage();
  await page.setContent(content);
  return page;
}

test.describe('parity comparison', () => {
  test('identical regions pass with zero difference', async ({ browser }) => {
    const a = await open(browser, html('Nissan Skyline', SPEC));
    const b = await open(browser, html('Nissan Skyline', SPEC));
    const result = await compareParity(a, b, { regions: REGIONS });
    expect(result.passed).toBe(true);
    expect(result.regions.map((r) => r.pixelDiff)).toEqual([0, 0]);
  });

  test('different text fails with a readable difference', async ({ browser }) => {
    const a = await open(browser, html('Nissan Skyline', SPEC));
    const b = await open(browser, html('Nissan Silvia', SPEC));
    const result = await compareParity(a, b, { regions: REGIONS });
    expect(result.passed).toBe(false);
    expect(result.regions[0]?.textsEqual).toBe(false);
    expect(result.regions[0]?.textDifference).toContain('Skyline');
    expect(result.regions[1]?.textsEqual).toBe(true);
  });

  test('the same texts in another order fail', async ({ browser }) => {
    const a = await open(browser, html('T', SPEC));
    const b = await open(browser, html('T', '<span>540 Nm</span><span>500 PS</span><span>2002</span>'));
    const result = await compareParity(a, b, { regions: ['r.spec'] });
    expect(result.regions[0]?.textsEqual).toBe(false);
    expect(result.passed).toBe(false);
  });

  test('same text but a large visual difference fails on pixels', async ({ browser }) => {
    const a = await open(browser, html('Titel', SPEC));
    const b = await open(browser, html('Titel', SPEC, '[data-testid="r.spec"] { background: #c8102e; }'));
    const result = await compareParity(a, b, { regions: ['r.spec'] });
    expect(result.regions[0]?.textsEqual).toBe(true);
    expect(result.regions[0]?.pixelDiff).toBeGreaterThan(MAX_REGION_DIFF);
    expect(result.regions[0]?.pixelsOk).toBe(false);
    expect(result.passed).toBe(false);
  });

  test('a small difference within the 3 % budget passes', async ({ browser }) => {
    const a = await open(browser, html('Titel', SPEC));
    const b = await open(browser, html('Titel', SPEC, '[data-testid="r.spec"] { box-shadow: inset 0 -1px 0 #c8102e; }'));
    const result = await compareParity(a, b, { regions: ['r.spec'] });
    expect(result.regions[0]?.pixelDiff).toBeGreaterThan(0);
    expect(result.regions[0]?.pixelDiff).toBeLessThanOrEqual(MAX_REGION_DIFF);
    expect(result.passed).toBe(true);
  });

  test('regions of different size count the extra area as different', async ({ browser }) => {
    const a = await open(browser, html('Titel', SPEC));
    const b = await open(browser, html('Titel', SPEC, '[data-testid="r.spec"] { height: 200px; }'));
    const result = await compareParity(a, b, { regions: ['r.spec'] });
    expect(result.regions[0]?.sameSize).toBe(false);
    expect(result.regions[0]?.pixelsOk).toBe(false);
  });

  test('a missing region fails instead of passing silently', async ({ browser }) => {
    const a = await open(browser, html('Titel', SPEC));
    const b = await open(browser, '<!doctype html><title>x</title><p>nichts</p>');
    b.setDefaultTimeout(500);
    await expect(compareParity(a, b, { regions: ['r.title'] })).rejects.toThrow();
  });

  test('text extraction reads what the user sees', async ({ page }) => {
    await page.setContent(`<div data-testid="r"><span style="text-transform:uppercase">nissan</span>
      <span style="display:none">verborgen</span><span>Skyline   R34</span></div>`);
    expect(await regionTexts(page, 'r')).toEqual(['NISSAN', 'Skyline R34']);
  });

  test('different splitting of the same text is equal', () => {
    expect(compareTexts(['Nissan Skyline', 'R34'], ['Nissan', 'Skyline R34']).equal).toBe(true);
  });
});
