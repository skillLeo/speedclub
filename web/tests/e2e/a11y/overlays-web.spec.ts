// Accessibility contract of Sheet, Dialog and Toast in a real browser. Jest runs the native branches, so everything
// here exists only on web: the focus trap of the React Native Web Modal, Escape, the scrim, the inert app behind an
// overlay, focus return, the aria-live region and the guard against a second press while an overlay animates out.
// Geometry and the toast's move between hosts live in flows/dev-gallery-primitives.spec.ts.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { QA_NOW } from '../support/qa.mjs';

const OVERLAYS = '/app/dev/gallery/overlays';

const VARIANTS = [
  { variant: 'sheet', panel: 'DEV-01.overlays.sheet', name: 'Foto bearbeiten' },
  { variant: 'dialog', panel: 'DEV-01.overlays.dialog', name: 'Änderungen verwerfen?' },
] as const;

const tabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
const shiftTabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');

const anyWithId = (page: Page, id: string): Locator => page.locator(`[data-testid="${id}"]`);

async function expectAppInert(page: Page, inert: boolean): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false)).toBe(inert);
}

/** Where the focus sits: the id of the dialog around it, "app" inside the inert root, "nowhere" on the body. */
const focusPlace = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'nowhere';
    if (document.getElementById('root')?.contains(active)) return 'app';
    return active.closest('[role="dialog"]')?.getAttribute('aria-label') ?? 'outside any dialog';
  });

async function openFromKeyboard(page: Page, opener: Locator): Promise<void> {
  await opener.focus();
  await page.keyboard.press('Enter');
}

test.describe('sheet and dialog on web', () => {
  for (const { variant, panel, name } of VARIANTS) {
    test.describe(variant, () => {
      test('is a named modal dialog, and focus moves into it', async ({ page, qaGoto, byTestId }) => {
        await qaGoto(OVERLAYS);
        await openFromKeyboard(page, byTestId(`DEV-01.overlays.open.${variant}`));
        await expect(byTestId(panel)).toBeVisible();

        const dialog = page.getByRole('dialog', { name, exact: true });
        await expect(dialog).toHaveCount(1);
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect.poll(() => focusPlace(page)).toBe(name);
      });

      test('traps Tab in both directions, across more stops than it has', async ({ page, qaGoto, byTestId, browserName }) => {
        await qaGoto(OVERLAYS);
        await openFromKeyboard(page, byTestId(`DEV-01.overlays.open.${variant}`));
        await expect(byTestId(panel)).toBeVisible();

        const stops = new Set<string>();
        for (const key of [tabKey(browserName), shiftTabKey(browserName)]) {
          for (let press = 1; press <= 8; press++) {
            await page.keyboard.press(key);
            expect(await focusPlace(page), `${key} press ${press}`).toBe(name);
            stops.add(await page.evaluate(() => document.activeElement?.textContent ?? ''));
          }
        }
        // A trap that sits on one element would pass the loop above and still lock the actions away.
        expect(stops.size).toBeGreaterThan(1);
      });

      test('Escape closes it, the app is back and focus returns to the trigger', async ({ page, qaGoto, byTestId }) => {
        await qaGoto(OVERLAYS);
        const opener = byTestId(`DEV-01.overlays.open.${variant}`);
        await openFromKeyboard(page, opener);
        await expect(byTestId(panel)).toBeVisible();
        await expectAppInert(page, true);

        await page.keyboard.press('Escape');

        await expect(anyWithId(page, panel)).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expectAppInert(page, false);
        await expect(opener).toBeFocused();
      });

      test('the scrim closes it, the app is back and focus returns to the trigger', async ({ page, qaGoto, byTestId }) => {
        await qaGoto(OVERLAYS);
        const opener = byTestId(`DEV-01.overlays.open.${variant}`);
        await openFromKeyboard(page, opener);
        await expect(byTestId(panel)).toBeVisible();

        await anyWithId(page, `${panel}.scrim`).click({ position: { x: 8, y: 8 } });

        await expect(anyWithId(page, panel)).toHaveCount(0);
        await expectAppInert(page, false);
        await expect(opener).toBeFocused();
      });

      test('the app behind it takes no click while open, and all of them once released', async ({ page, qaGoto, byTestId }) => {
        await qaGoto(OVERLAYS);
        const other = byTestId('DEV-01.overlays.open.sheet-full');
        await byTestId(`DEV-01.overlays.open.${variant}`).click();
        await expect(byTestId(panel)).toBeVisible();

        // Inert: the browser sends the pointer past it, and the only thing there is the scrim.
        await expect(other.click({ timeout: 1_000 })).rejects.toThrow();
        await expect(anyWithId(page, 'DEV-01.overlays.sheetFull')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(anyWithId(page, panel)).toHaveCount(0);
        await other.click();
        await expect(byTestId('DEV-01.overlays.sheetFull')).toBeVisible();
      });

      test('its own URL opens it, and closing releases the app', async ({ page, qaGoto, byTestId, browserName }) => {
        await qaGoto(`${OVERLAYS}?variant=${variant}`);
        await expect(byTestId(panel)).toBeVisible();
        await expectAppInert(page, true);

        await page.keyboard.press('Escape');

        await expect(anyWithId(page, panel)).toHaveCount(0);
        await expectAppInert(page, false);
        // No trigger to go back to: the keyboard must still get into the page.
        await page.keyboard.press(tabKey(browserName));
        await expect.poll(() => focusPlace(page)).toBe('app');
      });
    });
  }

  test('a dialog names what describes it', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(`${OVERLAYS}?variant=dialog`);
    await expect(byTestId('DEV-01.overlays.dialog')).toBeVisible();
    const describedBy = await page.getByRole('dialog').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('Deine Änderungen werden nicht gespeichert.');
  });

  test('Escape works from an input inside a sheet', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    const opener = byTestId('DEV-01.overlays.open.sheet-form');
    await openFromKeyboard(page, opener);
    const name = page.getByRole('dialog').getByRole('textbox', { name: 'Name' });
    await name.focus();
    await expect(name).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(anyWithId(page, 'DEV-01.overlays.sheetForm')).toHaveCount(0);
    await expectAppInert(page, false);
    await expect(opener).toBeFocused();
  });

  test('a sheet that is not dismissable keeps the trap and the hold until its action', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto(OVERLAYS);
    const opener = byTestId('DEV-01.overlays.open.sheet-locked');
    await openFromKeyboard(page, opener);
    await expect(byTestId('DEV-01.overlays.sheetLocked')).toBeVisible();

    await page.keyboard.press('Escape');
    await anyWithId(page, 'DEV-01.overlays.sheetLocked.scrim').click({ position: { x: 8, y: 8 } });
    await expect(byTestId('DEV-01.overlays.sheetLocked')).toBeVisible();
    await expectAppInert(page, true);
    await page.keyboard.press(tabKey(browserName));
    expect(await focusPlace(page)).toBe('Upload läuft');

    await byTestId('DEV-01.overlays.sheetLocked.done').click();
    await expect(anyWithId(page, 'DEV-01.overlays.sheetLocked')).toHaveCount(0);
    await expectAppInert(page, false);
    await expect(opener).toBeFocused();
  });
});

test.describe('dialog double-tap guard', () => {
  test('a double click on an action closes once and leaves no trace behind', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    const opener = byTestId('DEV-01.overlays.open.dialog-long');
    await openFromKeyboard(page, opener);
    await expect(byTestId('DEV-01.overlays.dialogLong')).toBeVisible();

    // The second click must meet the closing dialog, as it does for a member: the panel stays for its exit animation
    // (140 ms, 120 under reduced motion) and the guard lies in that time. Under qaMotion=off the exit is a timer of 0 ms,
    // which a loaded WebKit sometimes ran between the two clicks, so the second one hit the page behind and took the
    // focus off the opener (M1.9). Fake timers from here hold that timer until both clicks are in; then time goes on.
    // install() alone keeps time flowing, and its fake 0 ms timer still fired between the clicks (seen on WebKit on the
    // Mac): pauseAt stops the clock, so only runFor lets the exit run.
    await page.clock.install({ time: new Date(QA_NOW) });
    await page.clock.pauseAt(new Date(Date.parse(QA_NOW) + 1_000));
    await byTestId('DEV-01.overlays.dialogLong.cancel').dblclick();
    await page.clock.runFor(1_000);

    await expect(anyWithId(page, 'DEV-01.overlays.dialogLong')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectAppInert(page, false);
    await expect(opener).toBeFocused();
  });

  /**
   * Both handlers of the gallery only close, so a second call could not be seen by itself. Here the second press hits
   * the panel while it animates out, after another overlay has opened: a press that got through would close that one.
   * The presses run in one task, so no timer can unmount the panel between them, and React has flushed in between.
   */
  for (const { label, press } of [
    { label: 'action', press: 'DEV-01.overlays.dialogLong.delete' },
    { label: 'scrim', press: 'DEV-01.overlays.dialogLong.scrim' },
  ]) {
    test(`a second press on the ${label} of a closing dialog does nothing`, async ({ page, qaGoto, byTestId }) => {
      await qaGoto(`${OVERLAYS}?variant=dialog-long`);
      await expect(byTestId('DEV-01.overlays.dialogLong')).toBeVisible();

      const presses = await page.evaluate(
        async ({ press, opener }) => {
          const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
          const target = find(press);
          const open = find(opener);
          if (!target || !open) return 'missing element';
          target.click();
          await Promise.resolve();
          open.click();
          await Promise.resolve();
          if (!target.isConnected) return 'the panel was gone before the second press, so nothing was tested';
          target.click();
          return 'pressed twice';
        },
        { press, opener: 'DEV-01.overlays.open.dialog' },
      );
      expect(presses).toBe('pressed twice');

      await expect(anyWithId(page, 'DEV-01.overlays.dialogLong')).toHaveCount(0);
      await expect(byTestId('DEV-01.overlays.dialog'), 'the dialog that opened in between').toBeVisible();
      await expectAppInert(page, true);
    });
  }
});

test.describe('toast on web', () => {
  const MESSAGE = 'Aus deiner Garage entfernt.';

  test('is announced: its live region exists before it, holds its text and outlives it', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    // A live region created together with its content is not announced, so it must be there first.
    const region = anyWithId(page, 'DEV-01.overlays.toast.host');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveText('');

    await byTestId('DEV-01.overlays.open.toast').click();
    await expect(region).toContainText(MESSAGE);
    await expect(page.getByRole('status')).toContainText(MESSAGE);

    await byTestId('DEV-01.overlays.toast.action').click();
    await expect(anyWithId(page, 'DEV-01.overlays.toast')).toHaveCount(0);
    await expect(region).toHaveCount(1);
    await expect(region).toHaveText('');
  });

  test('goes by itself after its 4 s, and its action is a named button', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    await byTestId('DEV-01.overlays.open.toast').click();
    await expect(page.getByRole('status').getByRole('button', { name: 'Rückgängig', exact: true })).toBeVisible();
    await expect(anyWithId(page, 'DEV-01.overlays.toast')).toHaveCount(0, { timeout: 8_000 });
  });

  test('raised in a sheet it is announced from a live region inside the dialog', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(OVERLAYS);
    await byTestId('DEV-01.overlays.open.sheet-toast').click();
    await expect(byTestId('DEV-01.overlays.sheetToast')).toBeVisible();
    // The app behind is inert, so its own region would stay silent. There is one host, and it is the sheet's.
    const region = page.getByRole('dialog').getByRole('status');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveText('');

    await byTestId('DEV-01.overlays.sheetToast.raise').click();
    await expect(region).toContainText(MESSAGE);
    await expect(page.getByRole('status')).toHaveCount(1);
  });
});
