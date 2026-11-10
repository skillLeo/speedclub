// Keyboard access to the tab bar of the app shell.
import { expect, test } from '../support/fixtures';

test('the tab bar is reachable with the keyboard, in visual order', async ({ page, byTestId, browserName }) => {
  await page.goto('/app/');
  await expect(byTestId('HOME-01.root')).toBeVisible();
  // Safari moves between links with Option+Tab; Playwright's WebKit has the same default.
  const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const seen: string[] = [];
  // The bar follows the page's content in the DOM; since M2.2 Home holds more than 12 stops before it (hero, modules, stream).
  for (let i = 0; i < 80 && seen.length < 5; i++) {
    await page.keyboard.press(key);
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (id.startsWith('tab.') && !seen.includes(id)) seen.push(id);
  }
  expect(seen).toEqual(['tab.home', 'tab.discover', 'tab.garage', 'tab.messages', 'tab.profile']);
});
