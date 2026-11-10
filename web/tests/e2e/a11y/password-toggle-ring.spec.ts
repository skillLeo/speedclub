// DQ-113, ADR-118: the password toggle draws its ring inside its own shape. Its outer edge stays clear of the field's
// frame on every side, so the ring never merges with the frame, the red error frame included. Measured on AUTH-03.
import type { Locator, Page } from '@playwright/test';
import { parseColor, tokens } from '../support/tokens.mjs';
import { expect, test } from '../support/fixtures';

const FIELD = 'AUTH-03.password';
const TOGGLE = `${FIELD}.toggle`;

// Safari moves between controls with Option+Tab; Playwright's WebKit has the same default.
const tabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

type Box = { left: number; top: number; right: number; bottom: number };
type Ring = Box & { color: string; style: string; width: number };

/** The ring's outer edge: the outlined element inside the toggle, grown by offset + width (an inset ring: by nothing). */
const ringOf = (toggle: Locator): Promise<Ring | null> =>
  toggle.evaluate((node) => {
    const outlined = [node, ...node.querySelectorAll('*')].find((el) => {
      const cs = getComputedStyle(el);
      return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    });
    if (!outlined) return null;
    const cs = getComputedStyle(outlined);
    const grow = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
    const r = outlined.getBoundingClientRect();
    return {
      left: r.left - grow,
      top: r.top - grow,
      right: r.right + grow,
      bottom: r.bottom + grow,
      color: cs.outlineColor,
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
    };
  });

/** The inner edge of the field's frame: the absolutely placed bordered layer over the whole field. */
const frameOf = (page: Page): Promise<Box & { border: number }> =>
  page.locator(`[data-testid="${FIELD}.field"]:visible`).evaluate((field) => {
    const box = field.getBoundingClientRect();
    const frame = [...field.querySelectorAll('*')].find((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        cs.position === 'absolute' &&
        parseFloat(cs.borderTopWidth) > 0 &&
        Math.abs(r.left - box.left) < 0.5 &&
        Math.abs(r.right - box.right) < 0.5 &&
        Math.abs(r.top - box.top) < 0.5 &&
        Math.abs(r.bottom - box.bottom) < 0.5
      );
    });
    if (!frame) throw new Error('no frame layer in the field');
    const border = parseFloat(getComputedStyle(frame).borderTopWidth);
    return { left: box.left + border, top: box.top + border, right: box.right - border, bottom: box.bottom - border, border };
  });

/** The smallest gap between the ring's outer edge and the frame's inner edge, over all four sides. */
async function clearance(page: Page, toggle: Locator): Promise<{ ring: Ring; gap: number }> {
  await expect.poll(() => ringOf(toggle)).not.toBeNull();
  const ring = /** ring is there, polled above */ (await ringOf(toggle)) as Ring;
  const frame = await frameOf(page);
  const gap = Math.min(ring.left - frame.left, ring.top - frame.top, frame.right - ring.right, frame.bottom - ring.bottom);
  return { ring, gap };
}

const ringColour = (theme: string): string => {
  const { r, g, b } = parseColor(tokens.themes[theme].color['focus.ring']);
  return `rgb(${r}, ${g}, ${b})`;
};

for (const { width, theme, locale, fontScale } of [
  { width: 360, theme: 'light', locale: 'de', fontScale: 1 },
  { width: 390, theme: 'carbon', locale: 'de', fontScale: 1 },
  { width: 430, theme: 'black', locale: 'en', fontScale: 1 },
  { width: 1280, theme: 'carbon', locale: 'de', fontScale: 1 },
  { width: 390, theme: 'light', locale: 'de', fontScale: 2 },
] as const) {
  const name = `${width} ${theme} ${locale} x ${fontScale}`;

  test(`AUTH-03 ${name}: the toggle's ring stays clear of the field's frame`, async ({ page, qaGoto, byTestId, browserName }) => {
    await page.setViewportSize({ width, height: 844 });
    await qaGoto('/app/sign-in', { theme, locale, fontScale });
    await byTestId(FIELD).focus();
    await page.keyboard.press(tabKey(browserName));
    await expect(byTestId(TOGGLE)).toBeFocused();

    const { ring, gap } = await clearance(page, byTestId(TOGGLE));
    expect(ring).toMatchObject({ color: ringColour(theme), style: 'solid', width: tokens.size.border.focusRing });
    expect(gap, 'ground between ring and frame').toBeGreaterThanOrEqual(tokens.size.border.focusOffset);
  });
}

test('AUTH-03: with the red error frame the ring stays clear of it too', async ({ page, qaGoto, byTestId, browserName }) => {
  await qaGoto('/app/sign-in', { theme: 'carbon', locale: 'de' });
  // Leaving the empty password field shows its error and the red frame.
  await byTestId(FIELD).focus();
  await page.keyboard.press(tabKey(browserName));
  await expect(byTestId(TOGGLE)).toBeFocused();
  await expect(byTestId(`${FIELD}.error`)).toBeVisible();
  await expect(byTestId(FIELD)).toHaveAttribute('aria-invalid', 'true');

  const frame = await frameOf(page);
  expect(frame.border).toBeGreaterThan(0);
  const { gap } = await clearance(page, byTestId(TOGGLE));
  expect(gap, 'ground between ring and the error frame').toBeGreaterThanOrEqual(tokens.size.border.focusOffset);
});
