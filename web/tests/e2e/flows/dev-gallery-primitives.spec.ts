// DEV-01: behaviour of the web branches of the primitives, which Jest (native platform) never runs.
// Focus trap, Escape, scrim, inert release, focus return, toast inside an overlay, slider and viewer keys,
// skeleton geometry at large fonts, on-photo actions on their band.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { DEFAULT_THEME, parseColor, tokens } from '../support/tokens.mjs';

const OVERLAYS = '/app/dev/gallery/overlays';

const tabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

async function openWithKeyboard(page: Page, opener: Locator): Promise<void> {
  await opener.focus();
  await page.keyboard.press('Enter');
}

// The hold and its release are passive effects, so they land just after the panel appears or goes: poll, never read once.
const rootIsInert = (page: Page): Promise<boolean> => page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false);

async function expectTrapped(page: Page, key: string, presses = 6): Promise<void> {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    const inside = await page.evaluate(() => {
      const active = document.activeElement;
      return active !== null && active !== document.body && document.getElementById('root')?.contains(active) === false;
    });
    expect(inside, `focus left the overlay after ${i + 1} Tab presses`).toBe(true);
  }
}

test.describe('hug buttons', () => {
  test('at 360 x 200 % the labels wrap inside the column', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await qaGoto(OVERLAYS, { fontScale: 2 });
    await expect(byTestId('DEV-01.overlays.open.sheet')).toBeVisible();
    const buttons = page.locator('[data-testid^="DEV-01.overlays.open."]');
    expect(await buttons.count()).toBeGreaterThan(3);
    for (const box of await buttons.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute('data-testid'), left: rect.left, right: rect.right };
    }))) {
      expect(box.left, box.id ?? '').toBeGreaterThanOrEqual(16);
      expect(box.right, box.id ?? '').toBeLessThanOrEqual(344);
    }
  });
});

test.describe('unread badges in the navigation', () => {
  const box = async (page: Page, id: string) => {
    const found = await page.locator(`[data-testid="${id}"]`).boundingBox();
    if (!found) throw new Error(`no ${id}`);
    return found;
  };

  test('sidebar: 99+ sits at the end of the row, clear of the label and centred', async ({ page, qaGoto }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/dev/gallery/badges');
    const row = await box(page, 'DEV-01.badges.sidebar.128.messages');
    const pill = await box(page, 'DEV-01.badges.sidebar.128.messages.badge');
    expect(pill.x + pill.width).toBeCloseTo(row.x + row.width - 12, 0);
    expect(pill.y + pill.height / 2).toBeCloseTo(row.y + row.height / 2, 0);
    const label = page.locator('[data-testid="DEV-01.badges.sidebar.128.messages"]').getByText('Nachrichten');
    const text = await label.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().right;
    });
    expect(text).toBeLessThanOrEqual(pill.x);
  });

  test('bar: the forced focus ring stays inside its cell, clear of icon and label', async ({ page, qaGoto }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/dev/gallery/badges');
    const cell = page.locator('[data-testid="DEV-01.badges.bar.1.garage"]');
    const visual = cell.locator('> div').last();
    const style = await visual.evaluate((node) => {
      const css = getComputedStyle(node);
      return { offset: css.outlineOffset, width: css.outlineWidth, radius: css.borderTopLeftRadius };
    });
    expect(style).toEqual({ offset: '-2px', width: '2px', radius: '8px' });
    const icon = await cell.locator('svg').first().boundingBox();
    const cellBox = await cell.boundingBox();
    if (!icon || !cellBox) throw new Error('no cell or icon');
    expect(icon.y - cellBox.y).toBeGreaterThanOrEqual(2);
    expect(cellBox.height).toBe(64);
  });
});

test.describe('tab bar specimen on a phone (DQ-091)', () => {
  for (const { width, cell } of [{ width: 360, cell: 72 }, { width: 390, cell: 78 }, { width: 430, cell: 86 }]) {
    test(`${width}: runs edge to edge with the cells of the real bar`, async ({ page, qaGoto, byTestId }) => {
      await page.setViewportSize({ width, height: 800 });
      await qaGoto('/app/dev/gallery/badges');
      const bar = await byTestId('DEV-01.badges.bar.128').boundingBox();
      const tab = await byTestId('DEV-01.badges.bar.128.messages').boundingBox();
      if (!bar || !tab) throw new Error('no geometry');
      expect(bar.x).toBe(0);
      expect(bar.width).toBe(width);
      expect(tab.width).toBe(cell);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }
});

test.describe('overlays on web', () => {
  for (const [variant, panel] of [
    ['sheet', 'DEV-01.overlays.sheet'],
    ['dialog', 'DEV-01.overlays.dialog'],
  ] as const) {
    test(`${variant}: traps Tab, Escape closes, the app comes back and focus returns`, async ({ page, qaGoto, byTestId, browserName }) => {
      await qaGoto(OVERLAYS);
      const opener = byTestId(`DEV-01.overlays.open.${variant}`);
      await openWithKeyboard(page, opener);
      await expect(byTestId(panel)).toBeVisible();
      await expect.poll(() => rootIsInert(page)).toBe(true);

      await expectTrapped(page, tabKey(browserName));

      await page.keyboard.press('Escape');
      await expect(page.locator(`[data-testid="${panel}"]`)).toHaveCount(0);
      await expect.poll(() => rootIsInert(page)).toBe(false);
      await expect(opener).toBeFocused();
    });

    test(`${variant}: the scrim closes it`, async ({ page, qaGoto, byTestId }) => {
      await qaGoto(OVERLAYS);
      await byTestId(`DEV-01.overlays.open.${variant}`).click();
      await expect(byTestId(panel)).toBeVisible();
      await page.locator(`[data-testid="${panel}.scrim"]`).click({ position: { x: 8, y: 8 } });
      await expect(page.locator(`[data-testid="${panel}"]`)).toHaveCount(0);
      await expect.poll(() => rootIsInert(page)).toBe(false);
    });
  }

  test('a sheet that is not dismissable ignores Escape and the scrim', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    await byTestId('DEV-01.overlays.open.sheet-locked').click();
    await expect(byTestId('DEV-01.overlays.sheetLocked')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="DEV-01.overlays.sheetLocked.scrim"]').click({ position: { x: 8, y: 8 } });
    await expect(byTestId('DEV-01.overlays.sheetLocked')).toBeVisible();
    await expect.poll(() => rootIsInert(page)).toBe(true);
    await byTestId('DEV-01.overlays.sheetLocked.done').click();
    await expect(page.locator('[data-testid="DEV-01.overlays.sheetLocked"]')).toHaveCount(0);
    await expect.poll(() => rootIsInert(page)).toBe(false);
  });

  test('a toast raised inside a sheet is visible, announced and clickable', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    await byTestId('DEV-01.overlays.open.sheet-toast').click();
    await byTestId('DEV-01.overlays.sheetToast.raise').click();
    const toast = byTestId('DEV-01.overlays.toast');
    await expect(toast).toBeVisible();
    // One host: outside the inert app, in a live region.
    expect(await page.locator('[data-testid="DEV-01.overlays.toast"]').count()).toBe(1);
    expect(await toast.evaluate((node) => document.getElementById('root')?.contains(node) === false)).toBe(true);
    expect(await toast.evaluate((node) => node.closest('[aria-live="polite"]') !== null)).toBe(true);
    await byTestId('DEV-01.overlays.toast.action').click();
    await expect(page.locator('[data-testid="DEV-01.overlays.toast"]')).toHaveCount(0);
    await expect(byTestId('DEV-01.overlays.sheetToast')).toBeVisible();
  });

  test('a toast still showing when the sheet closes moves to the app host', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    await byTestId('DEV-01.overlays.open.sheet-toast').click();
    await byTestId('DEV-01.overlays.sheetToast.raise').click();
    await expect(byTestId('DEV-01.overlays.toast')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="DEV-01.overlays.sheetToast"]')).toHaveCount(0);
    await expect(byTestId('DEV-01.overlays.toast')).toBeVisible();
    expect(await byTestId('DEV-01.overlays.toast').evaluate((node) => document.getElementById('root')?.contains(node) === true)).toBe(true);
  });

  test('a long dialog at 200 % scrolls its text and keeps its actions on screen', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS, { fontScale: 2 });
    await byTestId('DEV-01.overlays.open.dialog-long').click();
    await expect(byTestId('DEV-01.overlays.dialogLong')).toBeVisible();
    const viewport = page.viewportSize();
    const panel = await byTestId('DEV-01.overlays.dialogLong').boundingBox();
    const cancel = await byTestId('DEV-01.overlays.dialogLong.cancel').boundingBox();
    if (!viewport || !panel || !cancel) throw new Error('no geometry');
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
    expect(cancel.y + cancel.height).toBeLessThanOrEqual(panel.y + panel.height);

    const scroll = byTestId('DEV-01.overlays.dialogLong.scroll');
    const overflow = await scroll.evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(overflow).toBeGreaterThan(0);
    await byTestId('DEV-01.overlays.dialogLong.input').scrollIntoViewIfNeeded();
    await expect(byTestId('DEV-01.overlays.dialogLong.input')).toBeInViewport();
    await expect(byTestId('DEV-01.overlays.dialogLong.cancel')).toBeInViewport();
  });

  test('a long dialog opened by keyboard rings its scroller in focus.ring, inset, and clears the text', async ({ page, qaGoto, byTestId, browserName }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await qaGoto(OVERLAYS, { fontScale: 2 });
    await openWithKeyboard(page, byTestId('DEV-01.overlays.open.dialog-long'));
    const scroll = byTestId('DEV-01.overlays.dialogLong.scroll');
    await expect(scroll).toBeVisible();
    const focused = await scroll.evaluate((node) => document.activeElement === node);
    // WebKit does not focus a scroller; its first stop is a control with its own ring.
    if (browserName === 'chromium') expect(focused).toBe(true);
    if (focused) {
      await expect.poll(() => scroll.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid');
      const ring = await scroll.evaluate((node) => {
        const style = getComputedStyle(node);
        return { width: style.outlineWidth, offset: style.outlineOffset, radius: style.borderRadius };
      });
      expect(ring).toEqual({ width: '2px', offset: '-2px', radius: `${tokens.radius.sm}px` });
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    }
    const box = await scroll.boundingBox();
    const title = await byTestId('DEV-01.overlays.dialogLong.title').boundingBox();
    const panel = await byTestId('DEV-01.overlays.dialogLong').boundingBox();
    if (!box || !title || !panel) throw new Error('no geometry');
    expect(title.x - box.x).toBe(8);
    expect(title.x - panel.x).toBe(24);
    // A field inside takes the focus for itself.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect.poll(() => scroll.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
  });

  test('a long dialog opened by pointer shows no ring on its scroller', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await qaGoto(OVERLAYS, { fontScale: 2 });
    await byTestId('DEV-01.overlays.open.dialog-long').click();
    const scroll = byTestId('DEV-01.overlays.dialogLong.scroll');
    await expect(scroll).toBeVisible();
    expect(await scroll.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
  });

  test('the viewer moves with the arrow keys and closes with Escape', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    const opener = byTestId('DEV-01.overlays.open.viewer');
    await openWithKeyboard(page, opener);
    const counter = byTestId('DEV-01.overlays.viewer.counter');
    await expect(counter).toHaveText('1/3');
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('1/3');
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('2/3');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('3/3');
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('2/3');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="DEV-01.overlays.viewer"]')).toHaveCount(0);
    await expect.poll(() => rootIsInert(page)).toBe(false);
    await expect(opener).toBeFocused();
  });
});

test.describe('text field focus (DQ-092)', () => {
  const DIALOG_INPUT = 'DEV-01.overlays.dialogLong.input';
  const frameOf = (field: Locator): Locator => field.locator('> div').last();
  // The width is read from the rule that sets it: browsers snap a computed border down to whole device pixels, and
  // Chromium does so at CSS pixels even under an emulated scale factor, so getComputedStyle reads 1.5 as 1.
  const borderOf = (frame: Locator) =>
    frame.evaluate((node) => {
      let width = (node as HTMLElement).style.borderTopWidth;
      for (const sheet of Array.from(document.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule instanceof CSSStyleRule && rule.style.borderTopWidth && node.matches(rule.selectorText)) {
            width = (node as HTMLElement).style.borderTopWidth || rule.style.borderTopWidth;
          }
        }
      }
      return { color: getComputedStyle(node).borderTopColor, width };
    });
  const colorOf = (theme: string, name: string): string => {
    const { r, g, b } = parseColor(tokens.themes[theme].color[name]);
    return `rgb(${r}, ${g}, ${b})`;
  };
  const activeTestId = (page: Page): Promise<string | null> =>
    page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

  async function expectFieldTakesTyping(page: Page, byTestId: (id: string) => Locator, theme: string): Promise<void> {
    const input = byTestId(DIALOG_INPUT);
    const field = byTestId(`${DIALOG_INPUT}.field`);
    await page.keyboard.type('abc');
    await expect(input).toHaveValue('abc');
    await expect
      .poll(() => borderOf(frameOf(field)))
      .toEqual({ color: colorOf(theme, 'text.primary'), width: `${tokens.size.border.inputFocus}px` });
    expect(await input.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
    expect(await field.getAttribute('tabindex')).toBeNull();
  }

  for (const { width, theme } of [
    { width: 360, theme: 'light' },
    { width: 390, theme: DEFAULT_THEME },
    { width: 430, theme: DEFAULT_THEME },
    { width: 1280, theme: DEFAULT_THEME },
  ]) {
    for (const way of ['keyboard', 'pointer'] as const) {
      test(`${width} ${theme}, opened by ${way}: first focus is the input of a dialog, and typed text arrives`, async ({ page, qaGoto, byTestId }) => {
        await page.setViewportSize({ width, height: 844 });
        await qaGoto(OVERLAYS, { theme });
        const opener = byTestId('DEV-01.overlays.open.dialog-long');
        if (way === 'keyboard') await openWithKeyboard(page, opener);
        else await opener.click();
        await expect(byTestId('DEV-01.overlays.dialogLong')).toBeVisible();

        await expect.poll(() => activeTestId(page)).toBe(DIALOG_INPUT);
        await expectFieldTakesTyping(page, byTestId, theme);
      });
    }
  }

  test('a dialog opened by its own URL also lands in the input', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(`${OVERLAYS}?variant=dialog-long`);
    await expect.poll(() => activeTestId(page)).toBe(DIALOG_INPUT);
    await expectFieldTakesTyping(page, byTestId, DEFAULT_THEME);
  });

  test('at 360 x 200 % the scroller may come first, and Tab reaches the input', async ({ page, qaGoto, byTestId, browserName }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await qaGoto(OVERLAYS, { fontScale: 2 });
    await openWithKeyboard(page, byTestId('DEV-01.overlays.open.dialog-long'));
    await expect(byTestId('DEV-01.overlays.dialogLong')).toBeVisible();
    const seen: (string | null)[] = [];
    for (let press = 0; press < 6 && (await activeTestId(page)) !== DIALOG_INPUT; press++) {
      seen.push(await activeTestId(page));
      await page.keyboard.press(tabKey(browserName));
    }
    expect(await activeTestId(page), `stops on the way: ${seen.join(', ')}`).toBe(DIALOG_INPUT);
    expect(seen).not.toContain(`${DIALOG_INPUT}.field`);
    await expectFieldTakesTyping(page, byTestId, DEFAULT_THEME);
  });

  test('hover: the border answers the pointer, and a disabled field does not', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const color = (name: string) => ({ color: colorOf(DEFAULT_THEME, name), width: `${tokens.size.border.control}px` });
    const field = byTestId('DEV-01.inputs.empty.field');
    await field.scrollIntoViewIfNeeded();
    await expect.poll(() => borderOf(frameOf(field))).toEqual(color('border.control'));

    await field.hover();
    await expect.poll(() => borderOf(frameOf(field))).toEqual(color('text.secondary'));
    await page.mouse.move(0, 0);
    await expect.poll(() => borderOf(frameOf(field))).toEqual(color('border.control'));

    const disabled = byTestId('DEV-01.inputs.disabled.field');
    await disabled.scrollIntoViewIfNeeded();
    await disabled.hover();
    // Nothing to wait for when it stays as it is: give a wrong hover the time to show.
    await page.waitForTimeout(tokens.motion.duration.micro);
    expect(await borderOf(frameOf(disabled))).toEqual(color('border.default'));
  });

  test('a click on the padding focuses the input, unless the field is disabled', async ({ qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    await byTestId('DEV-01.inputs.empty.field').click({ position: { x: 4, y: 4 } });
    await expect(byTestId('DEV-01.inputs.empty')).toBeFocused();

    await byTestId('DEV-01.inputs.disabled.field').click({ position: { x: 4, y: 4 } });
    await expect(byTestId('DEV-01.inputs.disabled')).not.toBeFocused();
  });

  test('the password toggle keeps its own press', async ({ qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId('DEV-01.inputs.password');
    await expect(input).toHaveAttribute('type', 'password');
    await byTestId('DEV-01.inputs.password.toggle').click();
    await expect(input).not.toHaveAttribute('type', 'password');
    await expect(input).not.toBeFocused();
  });

  test('search bar: no tab stop on its wrapper, a click focuses it, clear and cancel still work', async ({ qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId('DEV-01.inputs.searchLive');
    const field = byTestId('DEV-01.inputs.searchLive.field');
    expect(await field.getAttribute('tabindex')).toBeNull();

    await field.click({ position: { x: 4, y: 4 } });
    await expect(input).toBeFocused();
    await input.fill('BMW');
    await byTestId('DEV-01.inputs.searchLive.clear').click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await byTestId('DEV-01.inputs.searchLive.cancel').click();
    await expect(input).not.toBeFocused();
    await expect(byTestId('DEV-01.inputs.searchLive.cancel')).toHaveCount(0);
  });
});

test.describe('search bar is one focus scope (DQ-094)', () => {
  const EMPTY = 'DEV-01.inputs.search';
  const LIVE = 'DEV-01.inputs.searchLive';
  const activeElement = (page: Page): Promise<string> =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return 'BODY';
      return active.getAttribute('data-testid') ?? `value:${(active as HTMLInputElement).value}`;
    });
  const backKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  const ringOf = (action: Locator) =>
    action.locator('> div').last().evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
    });
  const anchorRing = (anchor: Locator) =>
    anchor.evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
    });
  const ringIn = (theme: string) => {
    const { r, g, b } = parseColor(tokens.themes[theme].color['focus.ring']);
    return { color: `rgb(${r}, ${g}, ${b})`, style: 'solid', width: `${tokens.size.border.focusRing}px` };
  };
  // DQ-096: the field keeps its focus frame while an action holds focus, and focus.ring is text.primary. A ring that ends on
  // the frame merges with it into one bar, so the outer edge of the action's ring has to stay clear of the field. The action
  // sits beside the field, or under it once the row stacks (DQ-060), so the gap counts on whichever side it actually opens:
  // a ring that overlaps the field in both directions stays negative and fails.
  const ringClearance = async (page: Page, action: Locator, prefix: string): Promise<number> => {
    const ring = await action.locator('> div').last().evaluate((node) => {
      const style = getComputedStyle(node);
      const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      const box = node.getBoundingClientRect();
      return { left: box.left - reach, top: box.top - reach };
    });
    const field = await page.locator(`[data-testid="${prefix}.field"]`).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { right: box.right, bottom: box.bottom };
    });
    return Math.max(ring.left - field.right, ring.top - field.bottom);
  };

  for (const { width, theme, locale, fontScale, label } of [
    { width: 360, theme: 'light', locale: 'de', fontScale: 1, label: 'Abbrechen' },
    { width: 390, theme: 'carbon', locale: 'de', fontScale: 1, label: 'Abbrechen' },
    { width: 430, theme: 'black', locale: 'en', fontScale: 1, label: 'Cancel' },
    { width: 1280, theme: 'carbon', locale: 'de', fontScale: 1, label: 'Abbrechen' },
    { width: 360, theme: 'light', locale: 'de', fontScale: 2, label: 'Abbrechen' },
  ] as const) {
    const name = `${width} ${theme} ${locale} x ${fontScale}`;

    test(`${name}: from an empty field Tab reaches the action with its ring, Enter collapses, Tab goes on`, async ({ page, qaGoto, byTestId, browserName }) => {
      await page.setViewportSize({ width, height: 844 });
      await qaGoto('/app/dev/gallery/inputs', { theme, locale, fontScale });
      const cancel = byTestId(`${EMPTY}.cancel`);

      await byTestId(EMPTY).focus();
      await page.keyboard.press(tabKey(browserName));
      expect(await activeElement(page)).toBe(`${EMPTY}.cancel`);
      await expect(cancel).toHaveAttribute('aria-label', label);
      await expect.poll(() => ringOf(cancel)).toEqual(ringIn(theme));
      expect(await ringClearance(page, cancel, EMPTY)).toBeGreaterThanOrEqual(tokens.size.border.focusOffset);

      await page.keyboard.press('Enter');
      await expect(cancel).toHaveCount(0);
      expect(await activeElement(page)).toBe(`${EMPTY}.focusAnchor`);
      await expect.poll(() => anchorRing(byTestId(`${EMPTY}.focusAnchor`))).toEqual(ringIn(theme));
      await page.keyboard.press(tabKey(browserName));
      expect(await activeElement(page)).toBe(LIVE);
    });

    test(`${name}: with text Tab goes clear, cancel, then the next control, never the page`, async ({ page, qaGoto, byTestId, browserName }) => {
      await page.setViewportSize({ width, height: 844 });
      await qaGoto('/app/dev/gallery/inputs', { theme, locale, fontScale });
      const input = byTestId(LIVE);
      const clear = byTestId(`${LIVE}.clear`);
      const cancel = byTestId(`${LIVE}.cancel`);

      await input.fill('BMW');
      await input.focus();
      await page.keyboard.press(tabKey(browserName));
      expect(await activeElement(page)).toBe(`${LIVE}.clear`);
      await expect.poll(() => ringOf(clear)).toEqual(ringIn(theme));
      await page.keyboard.press(tabKey(browserName));
      expect(await activeElement(page)).toBe(`${LIVE}.cancel`);
      await expect.poll(() => ringOf(cancel)).toEqual(ringIn(theme));
      expect(await ringClearance(page, cancel, LIVE)).toBeGreaterThanOrEqual(tokens.size.border.focusOffset);
      await page.keyboard.press(tabKey(browserName));
      expect(await activeElement(page)).toBe('value:Nissan');
      await expect(cancel).toHaveCount(0);
      await expect(input).toHaveValue('BMW');
    });
  }

  test('Escape in the field runs the cancel path, and Tab goes on from the bar', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(LIVE);
    await input.fill('BMW');
    await input.focus();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect(input).not.toBeFocused();
    await expect(byTestId(`${LIVE}.cancel`)).toHaveCount(0);
    expect(await activeElement(page)).toBe(`${LIVE}.focusAnchor`);
    await page.keyboard.press(tabKey(browserName));
    expect(await activeElement(page)).toBe('value:Nissan');
  });

  test('after cancel Shift+Tab returns to the field, and the field reopens the bar', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(EMPTY);
    await input.focus();
    await page.keyboard.press('Escape');
    await expect(byTestId(`${EMPTY}.cancel`)).toHaveCount(0);
    await page.keyboard.press(backKey(browserName));
    expect(await activeElement(page)).toBe(EMPTY);
    await expect(byTestId(`${EMPTY}.cancel`)).toHaveCount(1);
  });

  test('pointer: cancel by click shows no ring, and the anchor is no stop or target of its own', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(EMPTY);
    const anchor = page.locator(`[data-testid="${EMPTY}.focusAnchor"]`);
    expect(await anchor.getAttribute('tabindex')).toBe('-1');
    await input.click();
    await byTestId(`${EMPTY}.cancel`).click();
    await expect(byTestId(`${EMPTY}.cancel`)).toHaveCount(0);
    expect(await anchorRing(anchor)).toMatchObject({ style: 'none' });
    await input.click();
    await expect(input).toBeFocused();
  });

  test('Enter on cancel clears the text, Enter on clear keeps the bar open in the field', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(LIVE);
    await input.fill('BMW');
    await input.focus();
    await page.keyboard.press(tabKey(browserName));
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(byTestId(`${LIVE}.cancel`)).toHaveCount(1);

    await input.fill('BMW');
    await page.keyboard.press(tabKey(browserName));
    await page.keyboard.press(tabKey(browserName));
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(byTestId(`${LIVE}.cancel`)).toHaveCount(0);
  });

  test('Shift+Tab walks back inside the bar, and leaving it collapses', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(LIVE);
    await input.fill('BMW');
    await input.focus();
    await page.keyboard.press(tabKey(browserName));
    await page.keyboard.press(tabKey(browserName));
    expect(await activeElement(page)).toBe(`${LIVE}.cancel`);
    await page.keyboard.press(backKey(browserName));
    expect(await activeElement(page)).toBe(`${LIVE}.clear`);
    await page.keyboard.press(backKey(browserName));
    expect(await activeElement(page)).toBe(LIVE);
    await expect(byTestId(`${LIVE}.cancel`)).toHaveCount(1);
    await page.keyboard.press(backKey(browserName));
    expect(await activeElement(page)).not.toBe('BODY');
    await expect(byTestId(`${LIVE}.cancel`)).toHaveCount(0);
  });

  test('pointer: a click elsewhere collapses, also with focus on an action', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(EMPTY);
    const cancel = byTestId(`${EMPTY}.cancel`);
    await input.click();
    await expect(cancel).toHaveCount(1);
    await page.mouse.click(2, 2);
    await expect(cancel).toHaveCount(0);

    await input.focus();
    await page.keyboard.press(tabKey(browserName));
    expect(await activeElement(page)).toBe(`${EMPTY}.cancel`);
    await page.mouse.click(2, 2);
    await expect(cancel).toHaveCount(0);
  });

  test('pointer: a press slid off the action keeps the bar, and the next click elsewhere collapses it', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const input = byTestId(LIVE);
    const cancel = byTestId(`${LIVE}.cancel`);
    await input.fill('BMW');
    await input.click();
    const box = await cancel.boundingBox();
    if (!box) throw new Error('no cancel');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await page.waitForTimeout(tokens.motion.duration.micro * 2);
    await expect(input).toHaveValue('BMW');
    await expect(cancel).toHaveCount(1);
    await page.mouse.click(2, 2);
    await expect(cancel).toHaveCount(0);
  });

  test('switching window keeps the bar: focus has not moved', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const cancel = byTestId(`${EMPTY}.cancel`);
    await byTestId(EMPTY).focus();
    await page.keyboard.press(tabKey(browserName));
    await cancel.evaluate((node) => node.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await page.waitForTimeout(tokens.motion.duration.micro * 2);
    await expect(cancel).toHaveCount(1);
  });
});

test.describe('range slider on web', () => {
  test('Arrow, Page, Home and End move a thumb, which never passes the other', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/dev/gallery/inputs');
    const low = byTestId('DEV-01.inputs.range.low');
    const high = byTestId('DEV-01.inputs.range.high');
    const now = async (thumb: Locator) => Number(await thumb.getAttribute('aria-valuenow'));
    await low.focus();
    const start = await now(low);

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => now(low)).toBe(start + 10);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => now(low)).toBe(start);
    await page.keyboard.press('PageUp');
    await expect.poll(() => now(low)).toBe(start + 100);
    await page.keyboard.press('PageDown');
    await expect.poll(() => now(low)).toBe(start);
    await page.keyboard.press('Home');
    await expect.poll(() => now(low)).toBe(50);

    const upper = await now(high);
    await page.keyboard.press('End');
    await expect.poll(() => now(low)).toBe(upper - 10);

    await high.focus();
    await page.keyboard.press('End');
    await expect.poll(() => now(high)).toBe(1500);
    await page.keyboard.press('Home');
    await expect.poll(async () => (await now(high)) > (await now(low))).toBe(true);
  });
});

test.describe('skeleton geometry at large fonts (DQ-064)', () => {
  const height = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.height ?? Number.NaN;

  for (const fontScale of [1, 1.3, 1.5, 2]) {
    test(`at font scale ${fontScale} the row and card skeletons match the real ones`, async ({ qaGoto, byTestId }) => {
      await qaGoto('/app/dev/gallery/rows', { fontScale });
      const row = await height(byTestId('DEV-01.rows.update'));
      await qaGoto('/app/dev/gallery/cards', { fontScale });
      const card = await height(byTestId('DEV-01.cards.noPhoto'));

      await qaGoto('/app/dev/gallery/states', { fontScale });
      expect(Math.abs((await height(byTestId('DEV-01.states.skeletonRow'))) - row)).toBeLessThanOrEqual(1);
      expect(Math.abs((await height(byTestId('DEV-01.states.skeletonCard'))) - card)).toBeLessThanOrEqual(1);
    });
  }

  test('a wide row stays at one line per block at font scale 2', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/dev/gallery/rows', { fontScale: 2 });
    const row = await height(byTestId('DEV-01.rows.update'));
    await qaGoto('/app/dev/gallery/states', { fontScale: 2 });
    expect(Math.abs((await height(byTestId('DEV-01.states.skeletonRow'))) - row)).toBeLessThanOrEqual(1);
  });
});

test.describe('actions on a photo (DQ-022)', () => {
  for (const width of [360, 390, 430]) {
    for (const fontScale of [1, 2]) {
      test(`at ${width} and font scale ${fontScale} both labels sit on the band`, async ({ page, qaGoto, byTestId }) => {
        await page.setViewportSize({ width, height: 844 });
        await qaGoto('/app/dev/gallery/buttons', { fontScale });
        const band = byTestId('DEV-01.buttons.onPhotoRow');
        const box = await band.boundingBox();
        if (!box) throw new Error('no band');
        expect(await band.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0.72)');
        for (const id of ['DEV-01.buttons.onPhoto', 'DEV-01.buttons.onPhotoSkip']) {
          const label = await byTestId(id).boundingBox();
          if (!label) throw new Error(`no ${id}`);
          expect(label.y).toBeGreaterThanOrEqual(box.y);
          expect(label.y + label.height).toBeLessThanOrEqual(box.y + box.height);
          expect(label.x).toBeGreaterThanOrEqual(box.x);
          expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width);
        }
      });
    }
  }
});
