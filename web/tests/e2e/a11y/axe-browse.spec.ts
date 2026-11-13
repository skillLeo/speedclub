// Axe on the M1.8 browse tabs, no serious or critical issue on the whole page: HOME-01, DISC-01, DISC-02 (results for
// "r34" on both tabs, no result, the server's 422) and MSG-01, in the three themes on a phone and in carbon on desktop,
// guest and lukas.sc; then every forced state (qaState) of the four at 390 carbon. Chromium only (playwright.config.ts).
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { THEMES } from '../support/tokens.mjs';

type Screen = { name: string; path: string; auth: 'guest' | 'member'; ready: string; expected?: { status: number; url: RegExp } };

const SCREENS: Screen[] = [
  { name: 'HOME-01 guest', path: '/app/', auth: 'guest', ready: '[data-testid^="HOME-01.newBuilds.item."]' },
  { name: 'HOME-01 member', path: '/app/', auth: 'member', ready: '[data-testid^="HOME-01.newBuilds.item."]' },
  { name: 'DISC-01 guest', path: '/app/discover', auth: 'guest', ready: '[data-testid^="DISC-01.makes."]' },
  { name: 'DISC-02 r34', path: '/app/discover/search?q=r34', auth: 'guest', ready: ':is([data-testid^="DISC-02.vehicle."], [data-testid^="DISC-02.tile."])' },
  { name: 'DISC-02 member', path: '/app/discover/search?q=lukas', auth: 'member', ready: '[data-testid="DISC-02.member.lukas.sc"]' },
  { name: 'MSG-01 guest', path: '/app/messages', auth: 'guest', ready: '[data-testid="MSG-01.guest"]' },
];

/** Once at 390 carbon: what the matrix cells above do not reach. */
const SINGLES: Screen[] = [
  { name: 'DISC-02 no result', path: '/app/discover/search?q=zzqxv', auth: 'guest', ready: '[data-testid="DISC-02.noResults"]' },
  {
    name: 'DISC-02 invalid query',
    path: `/app/discover/search?q=${encodeURIComponent('!!!')}`,
    auth: 'guest',
    ready: '[data-testid="DISC-02.invalid"]',
    expected: { status: 422, url: /\/api\/v1\/search\?/ },
  },
  { name: 'DISC-02 start', path: '/app/discover/search', auth: 'guest', ready: '[data-testid="DISC-02.suggestions"]' },
  { name: 'MSG-01 member', path: '/app/messages', auth: 'member', ready: '[data-testid^="MSG-01.row."]' },
];

/** The forced states of each route and what proves it rendered (BrowseStates, MakeTiles, the shell's banner). */
const STATES: { path: string; route: string; states: Record<string, string> }[] = [
  {
    route: 'HOME-01',
    path: '/app/',
    states: { loading: 'HOME-01.skeleton', empty: 'HOME-01.empty', error: 'HOME-01.error', offline: 'shell.offline', restricted: 'HOME-01.restricted' },
  },
  {
    route: 'DISC-01',
    path: '/app/discover',
    states: { loading: 'DISC-01.skeleton', empty: 'DISC-01.empty', error: 'DISC-01.error', offline: 'shell.offline', restricted: 'DISC-01.restricted' },
  },
  {
    route: 'DISC-02',
    path: '/app/discover/search?q=r34',
    states: { loading: 'DISC-02.skeleton', empty: 'DISC-02.noResults', error: 'DISC-02.error', offline: 'shell.offline', restricted: 'DISC-02.restricted' },
  },
  { route: 'MSG-01', path: '/app/messages', states: { offline: 'MSG-01.offlineBanner' } },
];

const CELLS = [...THEMES.map((theme) => ({ theme, width: 390, height: 844 })), { theme: 'carbon', width: 1280, height: 800 }];

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    for (const { theme, width, height } of CELLS) {
      test(`${theme} at ${width}`, async ({ page, context, qaGoto }) => {
        if (screen.auth !== 'guest') await applyAuth(context, screen.auth);
        await page.setViewportSize({ width, height });
        await qaGoto(screen.path, { theme });
        await expect(page.locator(`${screen.ready}:visible`).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}

for (const screen of SINGLES) {
  test(`${screen.name}`, async ({ page, context, qaGoto, expectFailedResponses }) => {
    if (screen.expected) expectFailedResponses([screen.expected]);
    if (screen.auth !== 'guest') await applyAuth(context, screen.auth);
    await qaGoto(screen.path);
    await expect(page.locator(`${screen.ready}:visible`).first()).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });
}

test('DISC-02 r34 on the Mitglieder tab', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/discover/search?q=r34');
  await byTestId('DISC-02.tab.members').click();
  await expect(byTestId('DISC-02.member.kenji.r34')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

test('DISC-01 with recent searches and a typed query', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/discover');
  await page.getByTestId('DISC-01.search').fill('r34');
  await page.getByTestId('DISC-01.search').press('Enter');
  await expect(byTestId('DISC-02.root')).toBeVisible();
  await qaGoto('/app/discover');
  await expect(byTestId('DISC-01.recent')).toBeVisible();
  await page.getByTestId('DISC-01.search').fill('e46');
  await expect(byTestId('DISC-01.searchSubmit')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

for (const { route, path, states } of STATES) {
  test.describe(`${route} states`, () => {
    for (const [state, ready] of Object.entries(states)) {
      test(state, async ({ page, qaGoto, byTestId }) => {
        await qaGoto(path, { state });
        await expect(byTestId(ready).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}
