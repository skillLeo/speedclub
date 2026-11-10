// Axe on the M2.2 screens, no serious or critical issue on the whole page: HOME-01 Folge ich (lukas.sc with follows, a guest's
// sign-in prompt, nina.neu's empty state with suggestions), HOME-02 (lukas.sc's demo history with unread rows, a guest), in the three
// themes on a phone and in carbon on desktop; every forced state (qaState) of HOME-01 Folge ich and HOME-02 at 390 carbon. HOME-01
// Für dich with the FS-2 modules is axe-browse.spec.ts's HOME-01 (the same route). Read only: nothing is followed or marked read.
// Chromium only (playwright.config.ts).
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { THEMES } from '../support/tokens.mjs';

type Screen = { name: string; path: string; auth: string; ready: string };

const SCREENS: Screen[] = [
  { name: 'HOME-01 Folge ich member', path: '/app/?tab=following', auth: 'member', ready: '[data-testid^="HOME-01.card."]' },
  { name: 'HOME-01 Folge ich guest', path: '/app/?tab=following', auth: 'guest', ready: '[data-testid="HOME-01.following.guest"]' },
  { name: 'HOME-01 Folge ich suggestions', path: '/app/?tab=following', auth: 'member-empty', ready: '[data-testid^="HOME-01.suggestion."]' },
  { name: 'HOME-02 member', path: '/app/notifications', auth: 'member', ready: '[data-testid^="HOME-02.row."]' },
  { name: 'HOME-02 guest', path: '/app/notifications', auth: 'guest', ready: '[data-testid="HOME-02.guest"]' },
];

/** The forced states of each route and what proves it rendered. */
const STATES: { route: string; path: string; states: Record<string, string> }[] = [
  {
    route: 'HOME-01 Folge ich',
    path: '/app/?tab=following',
    states: { loading: 'HOME-01.following.skeleton', empty: 'HOME-01.following.empty', error: 'HOME-01.error', offline: 'shell.offline' },
  },
  {
    route: 'HOME-02',
    path: '/app/notifications',
    states: { loading: 'HOME-02.skeleton', empty: 'HOME-02.empty', error: 'HOME-02.error', offline: 'HOME-02.offline', restricted: 'HOME-02.restricted' },
  },
];

const CELLS = [...THEMES.map((theme) => ({ theme, width: 390, height: 844 })), { theme: 'carbon', width: 1280, height: 800 }];

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    for (const { theme, width, height } of CELLS) {
      test(`${theme} at ${width}`, async ({ page, context, qaGoto }) => {
        await applyAuth(context, screen.auth);
        await page.setViewportSize({ width, height });
        await qaGoto(screen.path, { theme });
        await expect(page.locator(`${screen.ready}:visible`).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}

for (const { route, path, states } of STATES) {
  for (const [state, ready] of Object.entries(states)) {
    test(`${route} ${state}`, async ({ page, context, qaGoto, byTestId }) => {
      await applyAuth(context, 'member');
      await qaGoto(path, { state });
      await expect(byTestId(ready).first()).toBeVisible();
      await assertNoSeriousAxeViolations(page);
    });
  }
}
