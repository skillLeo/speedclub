// M1.3 shell toast over a sticky CTA bar, in a real browser. After a password reset AUTH-07 sends the member to AUTH-03
// with "Passwort geändert": the toast sits 8 above the bar, so "Anmelden" stays clickable, and a mouse resting on the
// button does not hold the toast either. The reset answer is staged; the rest is the real app.
// The offset rules (tab bar, safe inset, keyboard) run in Jest: mobile/tests/ui/toastPlacement.test.ts and Toast*.test.tsx.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { QaOptions } from '../support/qa.mjs';

type QaGoto = (path: string, options?: QaOptions) => Promise<void>;

const EMAIL = 'jann.peters@example.de';
const PASSWORD = 'Kurvenlinie-2026';
/** reset.success of mobile/src/i18n/locales/de/auth.json. */
const SUCCESS = 'Dein Passwort ist geändert. Melde dich jetzt mit dem neuen Passwort an.';
const GAP = 8;
const TOAST_MS = 4000;

async function stage(page: Page, path: string, status: number, data: object): Promise<void> {
  await page.route(`**/api/v1${path}`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) })
      : route.fallback(),
  );
}

/** The space between the bottom of the toast and the top of the whole bar, hairline included. */
async function gapAbove(toast: Locator, bar: Locator): Promise<number | null> {
  const [box, barBox] = await Promise.all([toast.boundingBox(), bar.boundingBox()]);
  return box && barBox ? Math.round((barBox.y - (box.y + box.height)) * 10) / 10 : null;
}

/** The toast must leave the action free: 8 above the bar, the primary takes the click, the mouse on it holds nothing. */
async function expectClearOfBar(page: Page, toast: Locator, routeId: string): Promise<void> {
  const bar = page.locator(`[data-testid="${routeId}.cta.sticky"]:visible`);
  const primary = page.locator(`[data-testid="${routeId}.cta.primary"]:visible`);
  // The bar reports its height after its first layout and the toast follows.
  await expect.poll(() => gapAbove(toast, bar)).toBe(GAP);
  const box = await toast.boundingBox();
  const barBox = await bar.boundingBox();
  if (!box || !barBox) throw new Error('missing geometry');
  expect(box.y + box.height, 'the toast ends above the bar').toBeLessThanOrEqual(barBox.y);
  // Actionability: Playwright fails a trial click when another element would receive it.
  await primary.click({ trial: true, timeout: 2000 });
  await primary.hover();
  await expect(toast).toBeVisible();
  // Hover pauses a toast (WCAG 2.2.1); the mouse on the button is not on the toast, so it still leaves after its 4 s.
  await expect(toast).toHaveCount(0, { timeout: TOAST_MS + 4000 });
}

/** AUTH-07 at this size, a reset, and AUTH-03 with the success toast ("Dein Passwort ist geändert …"). */
async function resetAndSignIn(page: Page, qaGoto: QaGoto, byTestId: (id: string) => Locator, width: number, fontScale: number) {
  await page.setViewportSize({ width, height: 800 });
  await stage(page, '/auth/password/reset', 200, { next: 'sign_in', email: EMAIL, resend_after_seconds: null });
  await qaGoto(`/app/reset-password#code=482913&email=${encodeURIComponent(EMAIL)}`, { fontScale, locale: 'de' });
  await expect(byTestId('AUTH-07.root')).toBeVisible();
  await byTestId('AUTH-07.password').fill(PASSWORD);
  await byTestId('AUTH-07.passwordRepeat').fill(PASSWORD);
  // The mouse stays where it clicked: on the phone that is the bottom bar, where AUTH-03 has "Anmelden".
  await byTestId('AUTH-07.cta.primary').click();

  await expect(byTestId('AUTH-03.root')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/sign-in');
  const toast = byTestId('AUTH-07.successToast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(SUCCESS);
  return toast;
}

test.describe('the toast never covers a sticky CTA bar', () => {
  for (const { width, fontScale } of [
    { width: 360, fontScale: 1 },
    { width: 390, fontScale: 1 },
    { width: 390, fontScale: 2 },
  ]) {
    test(`${width} at font scale ${fontScale}: "Passwort geändert" after a reset sits above "Anmelden"`, async ({ page, qaGoto, byTestId }) => {
      const toast = await resetAndSignIn(page, qaGoto, byTestId, width, fontScale);
      await expectClearOfBar(page, toast, 'AUTH-03');
    });
  }

  // DQ-115: from 768 on, the auth forms have their primary right under the form and no sticky bar, so nothing covers the
  // bottom of the window and the toast keeps its 8 to the window edge (§8), clear of "Anmelden" wherever it lies.
  test('1280 at font scale 1: "Passwort geändert" after a reset leaves the inline "Anmelden" free', async ({ page, qaGoto, byTestId }) => {
    const toast = await resetAndSignIn(page, qaGoto, byTestId, 1280, 1);
    await expect(page.locator('[data-testid="AUTH-03.cta.sticky"]')).toHaveCount(0);
    const primary = byTestId('AUTH-03.cta.primary');
    await expect(byTestId('AUTH-03.cta')).toBeVisible();
    await expect.poll(async () => {
      const box = await toast.boundingBox();
      return box ? Math.round((800 - (box.y + box.height)) * 10) / 10 : null;
    }).toBe(GAP);
    const [box, primaryBox] = await Promise.all([toast.boundingBox(), primary.boundingBox()]);
    if (!box || !primaryBox) throw new Error('missing geometry');
    const overlaps =
      box.x < primaryBox.x + primaryBox.width &&
      primaryBox.x < box.x + box.width &&
      box.y < primaryBox.y + primaryBox.height &&
      primaryBox.y < box.y + box.height;
    expect(overlaps, 'the toast and "Anmelden" share no pixel').toBe(false);
    await primary.click({ trial: true, timeout: 2000 });
    await primary.hover();
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: TOAST_MS + 4000 });
  });

  test('a toast raised on the form itself sits above its own bar', async ({ page, qaGoto, byTestId }) => {
    await stage(page, '/auth/password/forgot', 202, { next: 'reset_password', email: EMAIL, resend_after_seconds: 60 });
    await qaGoto(`/app/reset-password?email=${encodeURIComponent(EMAIL)}&resend=0`, { locale: 'de' });
    await expect(byTestId('AUTH-07.root')).toBeVisible();
    await byTestId('AUTH-07.resend').click();
    const toast = byTestId('AUTH-07.resentToast');
    await expect(toast).toBeVisible();
    await expectClearOfBar(page, toast, 'AUTH-07');
  });
});
