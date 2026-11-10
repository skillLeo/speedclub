// Axe on the M2.3 Discover screens, no serious or critical issue on the whole page: DISC-01 with Kollektionen (and, for lukas.sc,
// [SIG] "Mitglieder mit ähnlichen Autos"), DISC-02 with interpreted chips, with filters, as a grid, with no build for its filters and,
// from 1280, with the filter panel, DISC-03, DISC-04 with builds and with the wheel table, VEH-01 with [SIG] Ähnliche Builds and VEH-02
// with "Ähnliche suchen"; in the three themes on a phone and in carbon on desktop. Then the filter and sort sheets open, and every
// forced state (qaState) of DISC-02 with filters, DISC-03 and DISC-04 at 390 carbon. DISC-01 as a guest and the text search are also
// axe-browse.spec.ts's (M1.8). Read only. Chromium only (playwright.config.ts).
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { demoIds, R34 } from '../support/garage.mjs';
import { THEMES } from '../support/tokens.mjs';

type Screen = { name: string; path: string | ((ids: Awaited<ReturnType<typeof demoIds>>) => string); auth: string; ready: string };

const SCREENS: Screen[] = [
  { name: 'DISC-01 guest with Kollektionen', path: '/app/discover', auth: 'guest', ready: '[data-testid="DISC-01.collections.list"]' },
  { name: 'DISC-01 lukas.sc', path: '/app/discover', auth: 'member', ready: '[data-testid="DISC-01.similarMembers.header"]' },
  { name: 'DISC-02 interpreted', path: '/app/discover/search?q=r34&understand=1', auth: 'guest', ready: '[data-testid="DISC-02.chips.generation.r34"]' },
  {
    name: 'DISC-02 filtered',
    path: '/app/discover/search?make=bmw&wheel_diameter[]=19&wheel_diameter[]=20',
    auth: 'guest',
    ready: '[data-testid="DISC-02.root"]:has([data-testid="DISC-02.chips.wheel_diameter.20"]) :is([data-testid^="DISC-02.vehicle."], [data-testid^="DISC-02.tile."])',
  },
  { name: 'DISC-02 grid', path: '/app/discover/search?suspension_type[]=coilover&sort=power&view=grid', auth: 'guest', ready: '[data-testid^="DISC-02.tile."]' },
  { name: 'DISC-02 no build for the filters', path: '/app/discover/search?make=bmw&model=m4&wheel_diameter[]=19', auth: 'guest', ready: '[data-testid="DISC-02.noResultsFiltered"]' },
  { name: 'DISC-03 BMW', path: '/app/discover/make/bmw', auth: 'guest', ready: '[data-testid^="DISC-03.model."]' },
  { name: 'DISC-04 M3 builds', path: '/app/discover/model/bmw--m3', auth: 'guest', ready: '[data-testid^="DISC-04.vehicle."]' },
  { name: 'DISC-04 R34 wheels', path: '/app/discover/model/nissan--skyline-gt-r?segment=wheels&generation=r34', auth: 'guest', ready: '[data-testid^="DISC-04.wheels."][data-testid$=".size"]' },
  { name: 'VEH-01 Ähnliche Builds', path: `/app/v/${R34.slug}`, auth: 'guest', ready: '[data-testid="VEH-01.similar.header"]' },
  { name: 'VEH-02 Ähnliche suchen', path: (ids) => `/app/v/${R34.slug}/mods/${ids.r34Mod}`, auth: 'guest', ready: '[data-testid="VEH-02.searchSimilar"]' },
];

/** The forced states of each route and what proves it rendered. */
const STATES: { route: string; path: string; states: Record<string, string> }[] = [
  {
    route: 'DISC-02 filtered',
    path: '/app/discover/search?make=bmw&wheel_diameter[]=19',
    states: { loading: 'DISC-02.skeleton', empty: 'DISC-02.noResultsFiltered', error: 'DISC-02.error', offline: 'shell.offline', restricted: 'DISC-02.restricted' },
  },
  {
    route: 'DISC-03',
    path: '/app/discover/make/bmw',
    states: { loading: 'DISC-03.skeleton', empty: 'DISC-03.notFound', error: 'DISC-03.error', offline: 'shell.offline', restricted: 'DISC-03.restricted' },
  },
  {
    route: 'DISC-04',
    path: '/app/discover/model/bmw--m3',
    states: { loading: 'DISC-04.skeleton', empty: 'DISC-04.empty', error: 'DISC-04.error', offline: 'shell.offline', restricted: 'DISC-04.restricted' },
  },
];

const CELLS = [...THEMES.map((theme) => ({ theme, width: 390, height: 844 })), { theme: 'carbon', width: 1280, height: 800 }];

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    for (const { theme, width, height } of CELLS) {
      test(`${theme} at ${width}`, async ({ page, context, qaGoto }) => {
        await applyAuth(context, screen.auth);
        await page.setViewportSize({ width, height });
        const path = typeof screen.path === 'string' ? screen.path : screen.path(await demoIds());
        await qaGoto(path, { theme });
        await expect(page.locator(`${screen.ready}:visible`).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}

test('DISC-02 panel at 1280 with make, model and generations', async ({ page, qaGoto }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await qaGoto('/app/discover/search?make=bmw&model=m3&power_min=300&sort=power');
  await expect(page.locator('[data-testid="DISC-02.panel.filters.generation.e46"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid^="DISC-02.tile."]:visible').first()).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

test('DISC-02 with the filter sheet open', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/discover/search?make=bmw&model=m4');
  await byTestId('DISC-02.chips.filter').click();
  await expect(byTestId('DISC-02.filterSheet.panel.generation.g82')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

test('DISC-02 with the sort sheet open', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/discover/search?make=bmw');
  await byTestId('DISC-02.results.sort').click();
  await expect(byTestId('DISC-02.sortSheet.power')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
});

for (const { route, path, states } of STATES) {
  for (const [state, ready] of Object.entries(states)) {
    test(`${route} ${state}`, async ({ page, qaGoto, byTestId }) => {
      await qaGoto(path, { state });
      await expect(byTestId(ready).first()).toBeVisible();
      await assertNoSeriousAxeViolations(page);
    });
  }
}
