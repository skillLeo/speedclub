// Axe on the M2.1 social screens, no serious or critical issue on the whole page: PROF-02 (lukas.sc and a guest on jann.ptrs,
// nina.neu on the member who blocked her), PROF-04 (own Follower tab, jann.ptrs's Folge ich), PROF-05 and SET-08 (paul.roadster),
// in the three themes on a phone and in carbon on desktop; every forced state (qaState) at 390 carbon; and the overlays a member
// opens by a tap: the more sheet and the block dialog of PROF-02, the "Entfernen" confirm of PROF-04 and the "Freigeben" confirm of
// SET-08. Read only: every overlay is closed with Abbrechen, nothing is followed, blocked or saved. Chromium only
// (playwright.config.ts).
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test, type ExpectedFailure } from '../support/fixtures';
import { THEMES } from '../support/tokens.mjs';

type Screen = { name: string; path: string; auth: string; ready: string; expected?: ExpectedFailure[] };

const SCREENS: Screen[] = [
  { name: 'PROF-02 member', path: '/app/u/jann.ptrs', auth: 'member', ready: '[data-testid="PROF-02.follow"]' },
  { name: 'PROF-02 guest', path: '/app/u/jann.ptrs', auth: 'guest', ready: '[data-testid="PROF-02.follow"]' },
  {
    name: 'PROF-02 unavailable',
    path: '/app/u/paul.roadster',
    auth: 'member-empty',
    ready: '[data-testid="PROF-02.unavailable"]',
    expected: [{ status: 404, url: /\/api\/v1\/public\/users\/paul\.roadster(\/[a-z]+)?(\?.*)?$/ }],
  },
  { name: 'PROF-04 own followers', path: '/app/profile/connections?tab=followers', auth: 'member', ready: '[data-testid^="PROF-04.row."]' },
  { name: 'PROF-04 member following', path: '/app/u/jann.ptrs/connections?tab=following', auth: 'member', ready: '[data-testid^="PROF-04.row."]' },
  { name: 'PROF-04 guest followers', path: '/app/u/jann.ptrs/connections?tab=followers', auth: 'guest', ready: '[data-testid^="PROF-04.row."]' },
  // DQ-1087: PROF-05 opens the "Gespeichert" collection (COL-02).
  { name: 'PROF-05 saved', path: '/app/profile/saved', auth: 'member', ready: '[data-testid^="COL-02.item."]' },
  { name: 'SET-08 blocked', path: '/app/settings/privacy/blocked', auth: 'member-blocker', ready: '[data-testid="SET-08.row.nina.neu"]' },
  { name: 'SET-08 empty', path: '/app/settings/privacy/blocked', auth: 'member', ready: '[data-testid="SET-08.empty"]' },
];

/** The forced states of each route and what proves it rendered. */
const STATES: { route: string; path: string; auth: string; states: Record<string, string> }[] = [
  {
    route: 'PROF-02',
    path: '/app/u/jann.ptrs',
    auth: 'member',
    states: { loading: 'PROF-02.skeleton', empty: 'PROF-02.garage.empty', error: 'PROF-02.error', offline: 'shell.offline', restricted: 'PROF-02.unavailable' },
  },
  {
    route: 'PROF-04',
    path: '/app/u/jann.ptrs/connections?tab=following',
    auth: 'member',
    states: { loading: 'PROF-04.skeleton', empty: 'PROF-04.empty', error: 'PROF-04.error', offline: 'PROF-04.offline', restricted: 'PROF-04.unavailable' },
  },
  {
    route: 'PROF-05',
    path: '/app/profile/saved',
    auth: 'member',
    states: { loading: 'PROF-05.skeleton', error: 'PROF-05.error', offline: 'PROF-05.error' },
  },
  {
    route: 'SET-08',
    path: '/app/settings/privacy/blocked',
    auth: 'member-blocker',
    states: { loading: 'SET-08.skeleton', empty: 'SET-08.empty', error: 'SET-08.error', offline: 'SET-08.offline' },
  },
];

const CELLS = [...THEMES.map((theme) => ({ theme, width: 390, height: 844 })), { theme: 'carbon', width: 1280, height: 800 }];

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    for (const { theme, width, height } of CELLS) {
      test(`${theme} at ${width}`, async ({ page, context, qaGoto, expectFailedResponses }) => {
        if (screen.expected) expectFailedResponses(screen.expected);
        await applyAuth(context, screen.auth);
        await page.setViewportSize({ width, height });
        await qaGoto(screen.path, { theme });
        await expect(page.locator(`${screen.ready}:visible`).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}

for (const { route, path, auth, states } of STATES) {
  for (const [state, ready] of Object.entries(states)) {
    test(`${route} ${state}`, async ({ page, context, qaGoto, byTestId }) => {
      await applyAuth(context, auth);
      await qaGoto(path, { state });
      await expect(byTestId(ready).first()).toBeVisible();
      await assertNoSeriousAxeViolations(page);
    });
  }
}

test('PROF-02 with the more sheet, then the block dialog open', async ({ page, context, qaGoto, byTestId }) => {
  await applyAuth(context, 'member');
  await qaGoto('/app/u/jann.ptrs');
  await byTestId('PROF-02.more').click();
  await expect(byTestId('PROF-02.moreSheet.block')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await byTestId('PROF-02.moreSheet.block').click();
  await expect(byTestId('PROF-02.blockDialog.confirm')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await byTestId('PROF-02.blockDialog.cancel').click();
  await expect(page.locator('[data-testid="PROF-02.blockDialog"]')).toHaveCount(0);
});

test('PROF-04 with the Entfernen confirm open', async ({ page, context, qaGoto, byTestId }) => {
  await applyAuth(context, 'member');
  await qaGoto('/app/profile/connections?tab=followers');
  await byTestId('PROF-04.list').locator('[data-testid$=".remove"]:visible').first().click();
  await expect(byTestId('PROF-04.removeDialog.confirm')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await byTestId('PROF-04.removeDialog.cancel').click();
  await expect(page.locator('[data-testid="PROF-04.removeDialog"]')).toHaveCount(0);
});

test('SET-08 with the Freigeben confirm open', async ({ page, context, qaGoto, byTestId }) => {
  await applyAuth(context, 'member-blocker');
  await qaGoto('/app/settings/privacy/blocked');
  await byTestId('SET-08.row.nina.neu.unblock').click();
  await expect(byTestId('SET-08.dialog.confirm')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await byTestId('SET-08.dialog.cancel').click();
  await expect(page.locator('[data-testid="SET-08.dialog"]')).toHaveCount(0);
});
