// Keyboard access to the auth stack on web: the focus order of sign-in and sign-up follows what the eye reads, the
// focus is visible on the controls, and a member signs in without touching the mouse.
import type { Page } from '@playwright/test';
import { createMember, E2E_DOMAIN, resetAuthLimits } from '../support/backend.mjs';
import { measureKeyboardFocus } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';

/** The testIDs that receive focus, in order, until `last` has it or `max` presses are done. */
async function tabUntil(page: Page, key: string, last: string, max = 40): Promise<string[]> {
  const order: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '');
    order.push(focused);
    if (focused === last) break;
  }
  return order;
}

// Safari moves between links with Option+Tab; Playwright's WebKit has the same default.
const tabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

test('AUTH-03: focus goes back, e-mail, password, show, forgot, sign-up, then the button', async ({ page, qaGoto, byTestId, browserName }) => {
  await qaGoto('/app/sign-in');
  await expect(byTestId('AUTH-03.root')).toBeVisible();
  const order = await tabUntil(page, tabKey(browserName), 'AUTH-03.cta.primary');
  expect(order.filter((id) => id.startsWith('AUTH-03.'))).toEqual([
    'AUTH-03.header.back',
    'AUTH-03.email',
    'AUTH-03.password',
    'AUTH-03.password.toggle',
    'AUTH-03.forgot',
    'AUTH-03.toSignUp',
    'AUTH-03.cta.primary',
  ]);
});

test('AUTH-04: the consents and their links come in reading order, before the button', async ({ page, qaGoto, byTestId, browserName }) => {
  await qaGoto('/app/sign-up');
  await expect(byTestId('AUTH-04.root')).toBeVisible();
  const order = await tabUntil(page, tabKey(browserName), 'AUTH-04.cta.primary');
  expect(order.filter((id) => id.startsWith('AUTH-04.'))).toEqual([
    'AUTH-04.header.back',
    'AUTH-04.email',
    'AUTH-04.password',
    'AUTH-04.password.toggle',
    'AUTH-04.ageConfirmed',
    'AUTH-04.termsAccepted',
    'AUTH-04.termsAccepted.read',
    'AUTH-04.privacyAccepted',
    'AUTH-04.privacyAccepted.read',
    'AUTH-04.marketingConsent',
    'AUTH-04.toSignIn',
    'AUTH-04.cta.primary',
  ]);
});

// WAI-ARIA APG checkbox pattern: Space toggles. Enter is what React Native Web's Pressable reacts to.
for (const key of ['Space', 'Enter']) {
  test(`AUTH-04: ${key} ticks a focused checkbox`, async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/sign-up');
    const box = byTestId('AUTH-04.ageConfirmed');
    await box.focus();
    await page.keyboard.press(key);
    await expect(box).toHaveAttribute('aria-checked', 'true');
  });
}

test('AUTH-03: the controls show where the focus is', async ({ page, qaGoto, byTestId, browserName }) => {
  await qaGoto('/app/sign-in');
  await expect(byTestId('AUTH-03.root')).toBeVisible();
  for (const target of ['AUTH-03.forgot', 'AUTH-03.cta.primary', 'AUTH-03.password.toggle']) {
    const focus = await measureKeyboardFocus(page, `[data-testid="${target}"]:visible`, { key: tabKey(browserName) });
    expect(focus.focused, `${target} is reachable`).toBe(true);
    expect(focus.visible, `${target} shows its focus`).toBe(true);
  }
});

test('signing in with the keyboard alone', async ({ page, qaGoto, byTestId, browserName }) => {
  // An account of its own: a browser signing in as a seeded member is a new device, and that member's unread "new device" row
  // would put the Start dot on the screens the visual matrix takes of them.
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `kbd.signin.${run}@${E2E_DOMAIN}`;
  const password = `Ladeluft-${run}-Kurve`;
  await createMember(email, `kbd${run}`.slice(0, 24), password);
  await qaGoto('/app/sign-in');
  await expect(byTestId('AUTH-03.root')).toBeVisible();
  const key = tabKey(browserName);
  await tabUntil(page, key, 'AUTH-03.email');
  await page.keyboard.type(email);
  await page.keyboard.press(key);
  await expect(byTestId('AUTH-03.password')).toBeFocused();
  await page.keyboard.type(password);
  await resetAuthLimits([email]);
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST');
  // Enter in the password field sends the form.
  await page.keyboard.press('Enter');
  expect((await answer).status()).toBe(200);
  await expect(byTestId('HOME-01.root')).toBeVisible();
});
