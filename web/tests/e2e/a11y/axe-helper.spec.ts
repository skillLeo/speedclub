// Proves the axe helper against known-good and known-bad pages.
import { expect, test } from '../support/fixtures';
import { assertNoSeriousAxeViolations, runAxe } from '../support/a11y.mjs';

const doc = (body: string, css = ''): string =>
  `<!doctype html><html lang="de"><head><title>Test</title><style>${css}</style></head><body><main>${body}</main></body></html>`;

test.describe('axe helper', () => {
  test('a control without a name is a failing violation', async ({ page }) => {
    await page.setContent(doc('<button></button>'));
    const { failing } = await runAxe(page);
    expect(failing.map((v) => v.id)).toContain('button-name');
    await expect(assertNoSeriousAxeViolations(page)).rejects.toThrow(/button-name/);
  });

  test('a clean page passes', async ({ page }) => {
    await page.setContent(doc('<h1>Garage</h1><button>Weiter</button>'));
    await assertNoSeriousAxeViolations(page);
  });

  const twoRegions = doc('<div id="ok"><button>Weiter</button></div><div id="bad"><button></button></div>');

  test('include narrows the scope', async ({ page }) => {
    await page.setContent(twoRegions);
    await assertNoSeriousAxeViolations(page, { include: ['#ok'] });
    await expect(assertNoSeriousAxeViolations(page, { include: ['#bad'] })).rejects.toThrow();
  });

  test('exclude narrows the scope', async ({ page }) => {
    await page.setContent(twoRegions);
    await assertNoSeriousAxeViolations(page, { exclude: ['#bad'] });
  });
});
