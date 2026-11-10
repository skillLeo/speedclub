// Keyboard use of the Phase 2 screens (WCAG 2.1.1, 2.4.3), in the style of keyboard-discover: MSG-01 rows open with Enter, MSG-02's
// composer is reached by Tab, sends with Enter and breaks a line with Shift+Enter; the DISC-02 filter sheet opens from its chip,
// takes the focus and gives it back on Escape; the report sheet opens from PROF-02's more sheet and walks with Tab and Enter; and the
// [SIG sig.web_shortcuts] of the desktop web: ⌘K / Ctrl+K quick switcher, `/` to the search, `g h` home, `?` the shortcut sheet.
//
// Writing happens only between members of this spec; lukas.sc's demo inbox is only opened (jann.ptrs's thread holds nothing unread
// for him) and the report sheet is left at its details step, never sent. WebKit reaches buttons and links with Option+Tab (README).
import type { Page } from '@playwright/test';
import { applyAuth, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { follow, id, isCall, members, open, pathOf, startConversation } from '../support/flow';

const tabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
const JANN = '01m5wpk0c0e8jjewpe4ycappww';

/** Tabs from the top of the page until `selector` has the focus; fails after `max` presses. */
async function tabTo(page: Page, key: string, selector: string, max = 40): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const target = page.locator(selector).first();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false)) return;
  }
  throw new Error(`${selector} never got the focus within ${max} presses of ${key}`);
}

const focusInside = (page: Page, testId: string): Promise<boolean> =>
  page.evaluate((tid) => Boolean(document.querySelector(`[data-testid="${tid}"]`)?.contains(document.activeElement)), testId);

test.describe('messaging by keyboard', () => {
  test('an MSG-01 row opens its thread with Enter', async ({ page, context }) => {
    await applyAuth(context, 'member');
    await open(page, '/app/messages');
    const rowLink = id(page, `MSG-01.row.${JANN}.open`);
    await rowLink.focus();
    await expect(rowLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => pathOf(page)).toBe(`/app/messages/${JANN}`);
  });

  test('MSG-02: Tab reaches the composer; Shift+Enter breaks the line, Enter sends', async ({ page, context, browserName }) => {
    test.setTimeout(90_000);
    const [me, other] = await members('kbcomposer', 'kbcomposerb');
    await follow(other, me.username);
    const { conversation } = await startConversation(me, other.username, 'Servus');
    await useSession(context, me.session);
    await open(page, `/app/messages/${conversation.id}`);
    const field = id(page, 'MSG-02.composer.input');
    await expect(field).toBeVisible();
    await tabTo(page, tabKey(browserName), '[data-testid="MSG-02.composer.input"]:visible');
    await page.keyboard.type('Zeile eins');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Zeile zwei');
    await expect(field).toHaveValue('Zeile eins\nZeile zwei');
    const sent = page.waitForResponse(isCall('POST', `conversations/${conversation.id}/messages`));
    await page.keyboard.press('Enter');
    expect((await sent).request().postDataJSON().body).toBe('Zeile eins\nZeile zwei');
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
  });
});

test.describe('sheets by keyboard', () => {
  test('the DISC-02 filter sheet opens from its chip, holds the focus, and Escape gives it back', async ({ page }) => {
    await open(page, '/app/discover/search?q=r34');
    const chip = id(page, 'DISC-02.chips.filter');
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(id(page, 'DISC-02.filterSheet')).toBeVisible();
    await expect.poll(() => focusInside(page, 'DISC-02.filterSheet'), { message: 'the focus moves into the sheet' }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(id(page, 'DISC-02.filterSheet')).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('the report sheet opens from PROF-02 more and walks with Tab and Enter', async ({ page, context, browserName }) => {
    await applyAuth(context, 'member');
    await open(page, '/app/u/jann.ptrs');
    const more = id(page, 'PROF-02.more');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(id(page, 'PROF-02.moreSheet')).toBeVisible();
    await tabTo(page, tabKey(browserName), '[data-testid="PROF-02.moreSheet.report.body"]:visible');
    await page.keyboard.press('Enter');
    await expect(id(page, 'PROF-02.report')).toBeVisible();
    await expect.poll(() => focusInside(page, 'PROF-02.report'), { message: 'the focus moves into the report sheet' }).toBe(true);
    await tabTo(page, tabKey(browserName), '[data-testid="PROF-02.report.reason.spam.body"]:visible');
    await page.keyboard.press('Enter');
    // The details step; nothing is sent.
    await expect(id(page, 'PROF-02.report.send')).toBeVisible();
    await expect(id(page, 'PROF-02.report.chosen')).toBeVisible();
  });
});

test.describe('web shortcuts on the desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('⌘K / Ctrl+K opens the quick switcher; typing and Enter go to Garage', async ({ page, context, browserName }) => {
    await applyAuth(context, 'member');
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.root')).toBeVisible();
    await page.keyboard.press(browserName === 'webkit' ? 'Meta+k' : 'Control+k');
    await expect(id(page, 'shell.switcher')).toBeVisible();
    await expect(id(page, 'shell.switcher.search')).toBeFocused();
    await page.keyboard.type('Garage');
    await expect(id(page, 'shell.switcher.option.tab.garage')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect.poll(() => pathOf(page)).toBe('/app/garage');
    await expect(id(page, 'shell.switcher')).toHaveCount(0);
  });

  test('`/` focuses the search, `g h` goes home, `?` opens the shortcut sheet', async ({ page }) => {
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.root')).toBeVisible();
    await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => undefined);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');
    await expect(id(page, 'DISC-01.search')).toBeFocused();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect.poll(() => pathOf(page)).toMatch(/^\/app\/?$/);

    await page.keyboard.press('?');
    await expect(id(page, 'shell.shortcuts')).toBeVisible();
    await expect(id(page, 'shell.shortcuts.switcher')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(id(page, 'shell.shortcuts')).toBeHidden();
  });

  test('no shortcut fires while typing in a field', async ({ page }) => {
    await open(page, '/app/discover');
    const search = id(page, 'DISC-01.search');
    await search.click();
    await page.keyboard.type('g h /');
    await expect(search).toHaveValue('g h /');
    expect(pathOf(page)).toBe('/app/discover');
    await expect(id(page, 'shell.shortcuts')).toHaveCount(0);
  });
});
