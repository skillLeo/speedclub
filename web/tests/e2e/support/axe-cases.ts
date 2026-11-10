// The common shape of the Phase 2 axe specs: each screen in the three themes on a phone and in carbon on desktop, every forced
// state (qaState) at 390 carbon, and overlays opened by a tap and closed again without changing anything. No serious or critical
// issue on the whole page (support/a11y.mjs). Chromium only (playwright.config.ts).
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { applyAuth } from './auth.mjs';
import { assertNoSeriousAxeViolations } from './a11y.mjs';
import { expect, test, type ExpectedFailure } from './fixtures';
import { THEMES } from './tokens.mjs';

/** An auth kind of support/auth.mjs, or a setup of its own (a member of the test's own, so it shares no per-member limit). */
export type AxeAuth = string | ((context: BrowserContext) => Promise<void>);
export type AxeScreen = { name: string; path: string | (() => Promise<string>); auth: AxeAuth; ready: string; expected?: ExpectedFailure[] };
export type AxeStates = { route: string; path: string | (() => Promise<string>); auth: AxeAuth; states: Record<string, string> };
export type AxeOverlay = {
  name: string;
  path: string | (() => Promise<string>);
  auth: AxeAuth;
  ready: string;
  /** Opens the overlay; answers the element that proves it is open. */
  open: (page: Page, byTestId: (id: string) => Locator) => Promise<Locator>;
  /** Closes it again (Abbrechen, Escape); by default Escape. */
  close?: (page: Page, byTestId: (id: string) => Locator) => Promise<void>;
  width?: number;
};

const CELLS = [...THEMES.map((theme) => ({ theme, width: 390, height: 844 })), { theme: 'carbon', width: 1280, height: 800 }];
const pathOf = async (path: AxeScreen['path']): Promise<string> => (typeof path === 'string' ? path : path());
const authorise = (context: BrowserContext, auth: AxeAuth): Promise<void> => (typeof auth === 'string' ? applyAuth(context, auth) : auth(context));

export function axeScreens(screens: AxeScreen[]): void {
  for (const screen of screens) {
    test.describe(screen.name, () => {
      for (const { theme, width, height } of CELLS) {
        test(`${theme} at ${width}`, async ({ page, context, qaGoto, expectFailedResponses }) => {
          if (screen.expected) expectFailedResponses(screen.expected);
          await authorise(context, screen.auth);
          await page.setViewportSize({ width, height });
          await qaGoto(await pathOf(screen.path), { theme });
          await expect(page.locator(`${screen.ready}:visible`).first()).toBeVisible();
          await assertNoSeriousAxeViolations(page);
        });
      }
    });
  }
}

export function axeStates(list: AxeStates[]): void {
  for (const { route, path, auth, states } of list) {
    for (const [state, ready] of Object.entries(states)) {
      test(`${route} ${state}`, async ({ page, context, qaGoto, byTestId }) => {
        await authorise(context, auth);
        await qaGoto(await pathOf(path), { state });
        await expect(byTestId(ready).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  }
}

export function axeOverlays(list: AxeOverlay[]): void {
  for (const overlay of list) {
    test(overlay.name, async ({ page, context, qaGoto, byTestId }) => {
      await authorise(context, overlay.auth);
      if (overlay.width) await page.setViewportSize({ width: overlay.width, height: 800 });
      await qaGoto(await pathOf(overlay.path));
      await expect(page.locator(`${overlay.ready}:visible`).first()).toBeVisible();
      const shown = await overlay.open(page, byTestId);
      await expect(shown).toBeVisible();
      await assertNoSeriousAxeViolations(page);
      if (overlay.close) await overlay.close(page, byTestId);
      else await page.keyboard.press('Escape');
      await expect(shown).toBeHidden();
    });
  }
}
