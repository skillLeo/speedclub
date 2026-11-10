// Proves the keyboard focus helpers against known-good and known-bad pages.
import { expect, test } from '../support/fixtures';
import { measureKeyboardFocus, recordFocusOrder } from '../support/a11y.mjs';

const doc = (body: string, css = ''): string =>
  `<!doctype html><html lang="de"><head><title>Test</title><style>${css}</style></head><body><main>${body}</main></body></html>`;

/**
 * The key the specs that use these helpers press: WebKit on macOS, like Safari without "Press Tab to highlight each item",
 * moves Tab between form fields and tabindex elements only and reaches buttons and links with Option held (support/a11y.mjs).
 */
const tabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

test.describe('focus helpers', () => {
  const buttons = '<button data-testid="one">Eins</button><button data-testid="two">Zwei</button><button data-testid="three">Drei</button>';

  test('focus order follows the Tab key', async ({ page, browserName }) => {
    await page.setContent(doc(buttons));
    expect(await recordFocusOrder(page, 3, { key: tabKey(browserName) })).toEqual(['one', 'two', 'three']);
  });

  test('a positive tabindex shows up as a wrong order', async ({ page, browserName }) => {
    await page.setContent(doc('<button data-testid="one">Eins</button><button data-testid="two" tabindex="1">Zwei</button>'));
    expect(await recordFocusOrder(page, 2, { key: tabKey(browserName) })).toEqual(['two', 'one']);
  });

  test('a visible ring is measured', async ({ page, browserName }) => {
    await page.setContent(doc(buttons, 'button:focus-visible { outline: 2px solid #f5f5f3; outline-offset: 2px; }'));
    const focus = await measureKeyboardFocus(page, '[data-testid="two"]', { key: tabKey(browserName) });
    expect(focus).toMatchObject({ focused: true, visible: true, outlineWidth: 2, outlineOffset: 2 });
  });

  test('a removed outline without replacement is not visible focus', async ({ page, browserName }) => {
    await page.setContent(doc(buttons, 'button { outline: none !important; }'));
    const focus = await measureKeyboardFocus(page, '[data-testid="one"]', { key: tabKey(browserName) });
    expect(focus).toMatchObject({ focused: true, visible: false });
  });

  test('a box-shadow ring counts as visible focus', async ({ page, browserName }) => {
    // appearance: none like every real control: WebKit drops box-shadow on natively styled buttons.
    await page.setContent(
      doc(buttons, 'button { appearance: none; background: transparent; outline: none !important; } button:focus-visible { box-shadow: 0 0 0 2px #f5f5f3; }'),
    );
    const focus = await measureKeyboardFocus(page, '[data-testid="one"]', { key: tabKey(browserName) });
    expect(focus.visible).toBe(true);
    expect(focus.changedProps).toContain('boxShadow');
  });

  test('a ring drawn by a child of the focused element counts, as in the app pressables', async ({ page, browserName }) => {
    await page.setContent(
      doc(
        '<div tabindex="0" data-testid="target"><span class="visual">Weiter</span></div>',
        '[data-testid="target"] { outline: none; } [data-testid="target"]:focus-visible .visual { outline: 2px solid #f5f5f3; outline-offset: 2px; }',
      ),
    );
    const focus = await measureKeyboardFocus(page, '[data-testid="target"]', { key: tabKey(browserName) });
    expect(focus).toMatchObject({ focused: true, visible: true, ringOn: 'descendant', outlineWidth: 2, outlineOffset: 2 });
  });

  test('a child that is always outlined is no focus ring', async ({ page, browserName }) => {
    await page.setContent(
      doc('<div tabindex="0" data-testid="target"><span style="outline: 1px solid #f5f5f3">Weiter</span></div>', '[data-testid="target"] { outline: none; }'),
    );
    const focus = await measureKeyboardFocus(page, '[data-testid="target"]', { key: tabKey(browserName) });
    expect(focus).toMatchObject({ focused: true, visible: false, ringOn: null });
  });

  test('an unreachable element reports focused: false', async ({ page, browserName }) => {
    await page.setContent(doc('<div data-testid="no">Kein Fokus</div><button>Weiter</button>'));
    const focus = await measureKeyboardFocus(page, '[data-testid="no"]', { key: tabKey(browserName), maxTabs: 3 });
    expect(focus.focused).toBe(false);
  });
});
