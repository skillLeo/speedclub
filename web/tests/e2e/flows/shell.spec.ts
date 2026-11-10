// M1.3 navigation shell in a real browser: which bar shows where, no remount across breakpoints, re-tap, guest
// browsing, the auth-required sheet, the app-config gates, the offline banner and the not-found page. Since M1.6 on the
// real screens: tab roots by their `<ROUTE-ID>.root`, lukas.sc's garage (GAR-01, GAR-02) and his R34 (VEH-01).
// /c/[code] and /app native-intent mapping run in Jest (mobile/tests/shell/nativeIntent.test.ts): web has no native intent.
import type { Locator, Page } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { demoIds, R34 } from '../support/garage.mjs';
import { tokens } from '../support/tokens.mjs';

const pathOf = (page: Page): string => new URL(page.url()).pathname;
const anyWithId = (page: Page, id: string): Locator => page.locator(`[data-testid="${id}"]`);
const HOME_PATH = /^\/app\/?$/;

const TABS = ['home', 'discover', 'garage', 'messages', 'profile'] as const;
const ROOTS: Record<(typeof TABS)[number], string> = {
  home: 'HOME-01.root',
  discover: 'DISC-01.root',
  garage: 'GAR-01.root',
  messages: 'MSG-01.root',
  profile: 'PROF-01.root',
};
const VEHICLE_PATH = `/app/v/${R34.slug}`;
const BARS = ['shell.tabbar', 'shell.rail', 'shell.sidebar'] as const;

async function expectOnlyBar(page: Page, bar: (typeof BARS)[number]): Promise<void> {
  for (const candidate of BARS) await expect(anyWithId(page, candidate), candidate).toHaveCount(candidate === bar ? 1 : 0);
}

/**
 * The element that scrolls the content of a screen: the screen root itself or the first visible scroller inside it.
 * Throws when nothing scrolls: the test would prove nothing.
 */
async function scrollerOf(locator: Locator) {
  const scroller = await locator.evaluateHandle((node) => {
    const scrolls = (el: Element): boolean =>
      /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight && el.checkVisibility();
    const found = [node, ...node.querySelectorAll('*')].find(scrolls);
    if (!found) throw new Error('nothing scrolls in this screen at this viewport');
    return found as HTMLElement;
  });
  return scroller.asElement() as NonNullable<ReturnType<typeof scroller.asElement>>;
}

/** VEH-01 of the R34 is on screen: the screen root, its own title and its URL. */
async function expectR34(page: Page, byTestId: (id: string) => Locator): Promise<void> {
  await expect(byTestId('VEH-01.root')).toBeVisible();
  await expect(byTestId('VEH-01.title')).toHaveText('Skyline GT-R R34');
  await expect.poll(() => pathOf(page)).toBe(VEHICLE_PATH);
}

test.describe('which bar shows at which width', () => {
  for (const { width, bar, side } of [
    { width: 360, bar: 'shell.tabbar', side: null },
    { width: 390, bar: 'shell.tabbar', side: null },
    { width: 767, bar: 'shell.tabbar', side: null },
    { width: 768, bar: 'shell.rail', side: tokens.layout.rail },
    { width: 1279, bar: 'shell.rail', side: tokens.layout.rail },
    { width: 1280, bar: 'shell.sidebar', side: tokens.layout.sidebar },
    { width: 1440, bar: 'shell.sidebar', side: tokens.layout.sidebar },
  ] as const) {
    test(`${width}: ${bar}, with the five tabs in one named tablist`, async ({ page, qaGoto }) => {
      const height = 800;
      await page.setViewportSize({ width, height });
      await qaGoto('/app/discover');
      await expectOnlyBar(page, bar);

      const list = page.getByRole('tablist', { name: 'Hauptnavigation', exact: true });
      await expect(list).toHaveCount(1);
      await expect(list.getByRole('tab')).toHaveCount(TABS.length);
      expect(await list.getByRole('tab').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))).toEqual(
        TABS.map((name) => `tab.${name}`),
      );
      await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
      await expect(anyWithId(page, 'tab.discover')).toHaveAttribute('aria-selected', 'true');

      const box = await anyWithId(page, bar).boundingBox();
      if (!box) throw new Error(`no ${bar}`);
      expect(box.x).toBe(0);
      if (side === null) {
        expect(box.width).toBe(width);
        expect(box.y + box.height).toBe(height);
      } else {
        expect(box.width).toBe(side);
        expect(box.y).toBe(0);
        expect(box.height).toBe(height);
        // The content starts where the bar ends.
        const content = await anyWithId(page, 'DISC-01.root').boundingBox();
        if (!content) throw new Error('no content');
        expect(content.x).toBeGreaterThanOrEqual(side);
      }
    });

    test(`${width}: the bar navigates`, async ({ page, qaGoto, byTestId }) => {
      await page.setViewportSize({ width, height: 800 });
      await qaGoto('/app/');
      await byTestId('tab.messages').click();
      await expect(byTestId(ROOTS.messages)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/messages');
      await expect(anyWithId(page, 'tab.messages')).toHaveAttribute('aria-selected', 'true');
      await expect(anyWithId(page, 'tab.home')).toHaveAttribute('aria-selected', 'false');
    });
  }
});

test.describe('crossing a breakpoint', () => {
  const STEPS = [
    { width: 768, bar: 'shell.rail' },
    { width: 1280, bar: 'shell.sidebar' },
    { width: 768, bar: 'shell.rail' },
    { width: 390, bar: 'shell.tabbar' },
  ] as const;

  test('the screen stays the same element and keeps its scroll position', async ({ page, qaGoto, byTestId }) => {
    // Low enough that the content overflows by more than the offset at every width: a wider screen wraps less.
    await page.setViewportSize({ width: 390, height: 200 });
    await qaGoto('/app/discover');
    await byTestId(ROOTS.discover).evaluate((node) => node.setAttribute('data-qa-kept', 'discover'));
    const scroller = await scrollerOf(byTestId(ROOTS.discover));
    await scroller.evaluate((node) => (node.scrollTop = 40));

    for (const { width, bar } of STEPS) {
      await page.setViewportSize({ width, height: 200 });
      await expectOnlyBar(page, bar);
      // React would have dropped this attribute with the element.
      await expect(page.locator('[data-qa-kept="discover"]:visible'), `at ${width}`).toHaveCount(1);
      expect(await scroller.evaluate((node) => node.isConnected), `at ${width}`).toBe(true);
      expect(await scroller.evaluate((node) => node.scrollTop), `at ${width}`).toBe(40);
    }
  });

  test('every tab keeps its stack, and the selection follows into the new bar', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    await qaGoto('/app/profile');
    await byTestId(`PROF-01.vehicle.${r34}`).click();
    await expectR34(page, byTestId);
    await byTestId('tab.garage').click();
    await byTestId(`GAR-01.card.${r34}`).click();
    await expect(byTestId('GAR-02.root')).toBeVisible();

    for (const { width, bar } of STEPS) {
      await page.setViewportSize({ width, height: 800 });
      await expectOnlyBar(page, bar);
      await expect(byTestId('GAR-02.root'), `at ${width}`).toBeVisible();
      await expect(anyWithId(page, 'tab.garage'), `at ${width}`).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => pathOf(page)).toBe(`/app/garage/${r34}`);
    }

    await byTestId('tab.profile').click();
    await expectR34(page, byTestId);
    await byTestId('VEH-01.header.back').click();
    await expect(byTestId(ROOTS.profile)).toBeVisible();
  });
});

test.describe('re-tap of the active tab', () => {
  // lukas.sc's garage: two cards and a draft, more than a low window shows.
  test.beforeEach(async ({ context }) => {
    await applyAuth(context, 'member');
  });

  test('scrolls a tab root to the top first, and stays there on the next one', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 300 });
    await qaGoto('/app/garage');
    const scroller = await scrollerOf(byTestId(ROOTS.garage));
    await scroller.evaluate((node) => (node.scrollTop = 60));

    await byTestId('tab.garage').click();
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
    expect(pathOf(page)).toBe('/app/garage');

    await byTestId('tab.garage').click();
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    expect(pathOf(page)).toBe('/app/garage');
    await expect(anyWithId(page, 'tab.garage')).toHaveAttribute('aria-selected', 'true');
  });

  test('pops a pushed screen to the root, then scrolls the root, one tap each', async ({ page, qaGoto, byTestId }) => {
    const { r34 } = await demoIds();
    await page.setViewportSize({ width: 390, height: 300 });
    await qaGoto('/app/garage');
    const scroller = await scrollerOf(byTestId(ROOTS.garage));
    await scroller.evaluate((node) => (node.scrollTop = 60));
    await byTestId(`GAR-01.card.${r34}`).click();
    await expect(byTestId('GAR-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(`/app/garage/${r34}`);

    await byTestId('tab.garage').click();
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/garage');
    const kept = await scroller.evaluate((node) => node.scrollTop);
    expect(kept, 'the pop alone leaves the root where it was').toBeGreaterThan(0);

    await byTestId('tab.garage').click();
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
    expect(pathOf(page)).toBe('/app/garage');
  });

  test('a press on another tab keeps that tab where it was', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 300 });
    await qaGoto('/app/garage');
    const scroller = await scrollerOf(byTestId(ROOTS.garage));
    await scroller.evaluate((node) => (node.scrollTop = 60));

    await byTestId('tab.home').click();
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await byTestId('tab.garage').click();
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    expect(await scroller.evaluate((node) => node.scrollTop)).toBe(60);
  });
});

test.describe('guest', () => {
  test('browses every tab and a vehicle without being asked to sign in', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/');
    for (const name of TABS) {
      await byTestId(`tab.${name}`).click();
      await expect(byTestId(ROOTS[name])).toBeVisible();
      await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
    }
    await page.goto(VEHICLE_PATH);
    await expectR34(page, byTestId);
    await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
  });

  test('the sign-in row lines up with the logo and the tab labels', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/discover');
    const row = await byTestId('shell.sidebar.signIn').boundingBox();
    const icon = await byTestId('shell.sidebar.signIn').locator('svg').boundingBox();
    const label = await byTestId('shell.sidebar.signIn').getByText('Anmelden').boundingBox();
    const tabLabel = await byTestId('tab.discover').getByText('Entdecken').boundingBox();
    if (!row || !icon || !label || !tabLabel) throw new Error('missing geometry');
    expect(row.height).toBe(tokens.size.row.single);
    expect(icon.x).toBe(24);
    expect(label.x).toBe(tabLabel.x);
    expect(label.x).toBe(60);
  });

  for (const fontScale of [1, 1.3, 1.5, 2]) {
    for (const width of [1280, 1440]) {
      test(`${width} at font scale ${fontScale}: "Anmelden" is whole and in line, its rows on whole pixels`, async ({ page, qaGoto, byTestId }) => {
        await page.setViewportSize({ width, height: 800 });
        await qaGoto('/app/discover', { fontScale, locale: 'de' });
        const signIn = byTestId('shell.sidebar.signIn');
        const label = signIn.getByText('Anmelden', { exact: true });
        await expect(label).toBeVisible();
        const fit = await label.evaluate((node) => ({
          clipped: node.scrollWidth > node.clientWidth,
          overflow: getComputedStyle(node).textOverflow,
        }));
        expect(fit.clipped).toBe(false);
        expect(fit.overflow).not.toBe('ellipsis');
        const box = await label.boundingBox();
        const row = await signIn.boundingBox();
        const icon = await signIn.locator('svg').boundingBox();
        if (!box || !row || !icon) throw new Error('missing geometry');
        expect(icon.width).toBe(24);
        expect(box.x).toBe(60);
        expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);

        const logo = await byTestId('shell.sidebar.logo').boundingBox();
        const add = await byTestId('shell.sidebar.addVehicle').boundingBox();
        const indicator = await byTestId('shell.sidebar.indicator').boundingBox();
        if (!logo || !add || !indicator) throw new Error('missing geometry');
        expect(logo.height).toBe(36);
        expect(Number.isInteger(add.y)).toBe(true);
        expect(Number.isInteger(indicator.y)).toBe(true);
      });
    }
  }

  test('the sidebar offers sign-in, which leaves the shell, and back returns', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/discover');
    await expect(anyWithId(page, 'shell.sidebar.account')).toHaveCount(0);

    await byTestId('shell.sidebar.signIn').click();
    await expect(byTestId('AUTH-03.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/sign-in');
    expect(new URL(page.url()).searchParams.has('returnTo')).toBe(false);
    await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);

    await byTestId('AUTH-03.header.back').click();
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/discover');
    await expect(byTestId('shell.sidebar')).toBeVisible();
  });
});

test.describe('auth-required sheet', () => {
  const WIZARD = '/add-vehicle/new/vehicle';
  const expectAppInert = async (page: Page, inert: boolean): Promise<void> => {
    await expect.poll(() => page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false)).toBe(inert);
  };

  // A guest's garage (GAR-01, M1.6) has no "+": its one action is the sign-in invitation, which comes back to the garage.
  // The sidebar's "Fahrzeug hinzufügen" still asks first and then goes on to the wizard.
  for (const { from, width, opener, returnTo } of [
    { from: 'the sidebar', width: 1280, opener: 'shell.sidebar.addVehicle', returnTo: WIZARD },
    { from: 'the garage invitation', width: 390, opener: 'GAR-01.guest.action', returnTo: '/garage' },
    { from: 'the garage invitation on a rail', width: 768, opener: 'GAR-01.guest.action', returnTo: '/garage' },
  ]) {
    test.describe(`from ${from}`, () => {
      test.beforeEach(async ({ page, qaGoto, byTestId }) => {
        await page.setViewportSize({ width, height: 800 });
        await qaGoto('/app/garage');
        await byTestId(opener).focus();
        await page.keyboard.press('Enter');
        await expect(byTestId('shell.authRequired')).toBeVisible();
      });

      test('names itself as a modal and does not navigate', async ({ page, byTestId }) => {
        await expect(page.getByRole('dialog', { name: 'Dafür brauchst du ein Konto', exact: true })).toHaveAttribute('aria-modal', 'true');
        await expect(byTestId('shell.authRequired.signIn')).toBeVisible();
        await expect(byTestId('shell.authRequired.signUp')).toBeVisible();
        await expectAppInert(page, true);
        expect(pathOf(page)).toBe('/app/garage');
      });

      test('cancel returns to the same place, with focus on the trigger', async ({ page, byTestId }) => {
        await byTestId('shell.authRequired.cancel').click();
        await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
        await expectAppInert(page, false);
        await expect(byTestId(opener)).toBeFocused();
        expect(pathOf(page)).toBe('/app/garage');
      });

      test('Escape returns to the same place, with focus on the trigger', async ({ page, byTestId }) => {
        await page.keyboard.press('Escape');
        await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
        await expectAppInert(page, false);
        await expect(byTestId(opener)).toBeFocused();
        expect(pathOf(page)).toBe('/app/garage');
      });

      test('the scrim returns to the same place', async ({ page, byTestId }) => {
        await anyWithId(page, 'shell.authRequired.scrim').click({ position: { x: 8, y: 8 } });
        await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
        await expectAppInert(page, false);
        await expect(byTestId(opener)).toBeFocused();
        expect(pathOf(page)).toBe('/app/garage');
      });

      for (const { action, route, path } of [
        { action: 'shell.authRequired.signIn', route: 'AUTH-03', path: '/app/sign-in' },
        { action: 'shell.authRequired.signUp', route: 'AUTH-04', path: '/app/sign-up' },
      ]) {
        test(`${route} carries the way back to ${returnTo}, and its back returns to the garage`, async ({ page, byTestId }) => {
          await byTestId(action).click();
          await expect(byTestId(`${route}.root`)).toBeVisible();
          await expect.poll(() => pathOf(page)).toBe(path);
          expect(new URL(page.url()).searchParams.get('returnTo')).toBe(returnTo);
          await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
          await expectAppInert(page, false);

          await byTestId(`${route}.header.back`).click();
          await expect(byTestId(ROOTS.garage)).toBeVisible();
          await expect.poll(() => pathOf(page)).toBe('/app/garage');
          await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
        });
      }
    });
  }

  test('a cancelled sheet opens again', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/garage');
    await byTestId('GAR-01.guest.action').click();
    await byTestId('shell.authRequired.cancel').click();
    await expect(anyWithId(page, 'shell.authRequired')).toHaveCount(0);
    await byTestId('GAR-01.guest.action').click();
    await expect(byTestId('shell.authRequired')).toBeVisible();
  });
});

/** What the browser logs about an answer a test staged on purpose. Anything else still fails the test. */
function dropStagedNetworkLogs(errors: string[]): void {
  const staged =
    /Failed to load resource|Fetch API cannot load|TypeError: (Failed to fetch|Load failed|Network)|Loading module .* failed|Importing a module script failed|Failed to fetch dynamically imported module/;
  const rest = errors.filter((entry) => !staged.test(entry));
  errors.splice(0, errors.length, ...rest);
}

type ConfigAnswer = { data: Record<string, unknown> } | { status: number } | 'abort';

/** Answers /app-config: the real payload with `data` over it, a status, or no answer at all. */
async function stageAppConfig(page: Page, first: ConfigAnswer) {
  const stage = { answer: first, requests: 0 };
  await page.route('**/api/v1/app-config*', async (route) => {
    stage.requests += 1;
    const { answer } = stage;
    if (answer === 'abort') {
      await route.abort('blockedbyclient');
    } else if ('status' in answer) {
      await route.fulfill({ status: answer.status, contentType: 'application/json', body: '{}' });
    } else {
      const headers = { ...route.request().headers() };
      delete headers['if-none-match'];
      const response = await route.fetch({ headers });
      const payload = (await response.json()) as { data: object };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...payload, data: { ...payload.data, ...answer.data } }),
      });
    }
  });
  return stage;
}

const MAINTENANCE = { data: { maintenance: { enabled: true, message: 'Wir tauschen gerade die Server.' } } };
const OPERATING = { data: { maintenance: { enabled: false, message: null } } };

test.describe('app-config gates', () => {
  // The app may still be asking when a test has seen what it came for; a stage answering after the end is an error.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('maintenance takes over from any route and shows the message of the team', async ({ page, byTestId }) => {
    await stageAppConfig(page, MAINTENANCE);
    await page.goto('/app/discover');
    await expect(byTestId('SYS-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/maintenance');
    await expect(byTestId('SYS-02.state.body')).toHaveText('Wir tauschen gerade die Server.');
    await expect(page.getByRole('tablist')).toHaveCount(0);
  });

  test('maintenance without a message says it in our words', async ({ page, byTestId }) => {
    await stageAppConfig(page, { data: { maintenance: { enabled: true, message: null } } });
    await page.goto('/app/');
    await expect(byTestId('SYS-02.state.body')).toContainText('wird gerade gewartet');
  });

  test('check again keeps the gate while maintenance lasts', async ({ page, byTestId }) => {
    const stage = await stageAppConfig(page, MAINTENANCE);
    await page.goto('/app/');
    await expect(byTestId('SYS-02.root')).toBeVisible();
    await expect.poll(() => stage.requests).toBeGreaterThan(0);
    const before = stage.requests;
    await byTestId('SYS-02.state.action').click();
    await expect.poll(() => stage.requests).toBe(before + 1);
    await expect(byTestId('SYS-02.state.action')).toBeEnabled();
    await expect(byTestId('SYS-02.root')).toBeVisible();
  });

  for (const deepLink of [VEHICLE_PATH, '/app/garage', '/app/settings/appearance']) {
    test(`a deep link to ${deepLink} is kept when the gate releases`, async ({ page, byTestId }) => {
      const stage = await stageAppConfig(page, MAINTENANCE);
      await page.goto(deepLink);
      await expect(byTestId('SYS-02.root')).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/maintenance');

      stage.answer = OPERATING;
      await byTestId('SYS-02.state.action').click();

      await expect(anyWithId(page, 'SYS-02.root').filter({ visible: true })).toHaveCount(0);
      await expect.poll(() => pathOf(page)).toBe(deepLink);
    });
  }

  test('the vehicle behind a released deep link is the one that was asked for', async ({ page, byTestId }) => {
    const stage = await stageAppConfig(page, MAINTENANCE);
    await page.goto(VEHICLE_PATH);
    await expect(byTestId('SYS-02.root')).toBeVisible();
    stage.answer = OPERATING;
    await byTestId('SYS-02.state.action').click();
    await expectR34(page, byTestId);
  });

  test('loading a gate route directly goes home once the server says all is well', async ({ page, byTestId }) => {
    await page.goto('/app/maintenance');
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await expect.poll(() => pathOf(page)).toMatch(HOME_PATH);
    await page.goto('/app/update-required');
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await expect.poll(() => pathOf(page)).toMatch(HOME_PATH);
  });

  test('the upgrade copy never splits a word, at any phone width and font scale', async ({ page, qaGoto, byTestId, pageErrors }) => {
    await stageAppConfig(page, { status: 503 });
    for (const width of [360, 390, 430]) {
      for (const fontScale of [1, 2]) {
        await page.setViewportSize({ width, height: 800 });
        await qaGoto('/app/update-required', { fontScale, locale: 'de' });
        const body = byTestId('SYS-01.state.body');
        await expect(body).toHaveText('Diese Version ist veraltet. Bitte installiere das Update.');
        const split = await body.evaluate((node) => {
          const text = node.firstChild as Text;
          const range = document.createRange();
          return [...text.data.matchAll(/\S+/g)]
            .filter((word) => {
              range.setStart(text, word.index);
              range.setEnd(text, word.index + word[0].length);
              return range.getClientRects().length > 1;
            })
            .map((word) => word[0]);
        });
        expect(split, `${width} x ${fontScale}`).toEqual([]);
      }
    }
    dropStagedNetworkLogs(pageErrors);
  });

  test('the upgrade screen stays while the server has not answered, and leaves when it does', async ({ page, byTestId, pageErrors }) => {
    const stage = await stageAppConfig(page, { status: 503 });
    await page.goto('/app/update-required');
    await expect(byTestId('SYS-01.root')).toBeVisible();
    await expect.poll(() => stage.requests).toBeGreaterThan(0);
    await expect(byTestId('SYS-01.state.title')).toHaveText('Update erforderlich');
    await expect(byTestId('SYS-01.state.action')).toBeEnabled();
    expect(pathOf(page)).toBe('/app/update-required');

    stage.answer = OPERATING;
    await byTestId('SYS-01.state.action').click();
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await expect.poll(() => pathOf(page)).toMatch(HOME_PATH);
    dropStagedNetworkLogs(pageErrors);
  });

  test('the web has no minimum version: a high one never sends it to the upgrade screen', async ({ page, byTestId }) => {
    const stage = await stageAppConfig(page, { data: { min_version: { ios: '99.0.0', android: '99.0.0' } } });
    await page.goto('/app/garage');
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    await expect.poll(() => stage.requests).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await expect(anyWithId(page, 'SYS-01.root')).toHaveCount(0);
    expect(pathOf(page)).toBe('/app/garage');
  });

  for (const status of [423, 503]) {
    test(`a first launch that gets ${status} runs on the bundled config instead of a gate`, async ({ page, byTestId, pageErrors }) => {
      const stage = await stageAppConfig(page, { status });
      await page.goto('/app/discover');
      await expect(byTestId(ROOTS.discover)).toBeVisible();
      await expect.poll(() => stage.requests).toBeGreaterThan(0);
      await expect(byTestId(ROOTS.discover)).toBeVisible();
      await expect(anyWithId(page, 'SYS-02.root')).toHaveCount(0);
      expect(pathOf(page)).toBe('/app/discover');
      dropStagedNetworkLogs(pageErrors);
    });
  }

  test('a malformed config is ignored and leaves a gate up to the next good answer', async ({ page, byTestId }) => {
    const stage = await stageAppConfig(page, { data: { maintenance: 'yes' } });
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto('/app/discover');
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await expect.poll(() => stage.requests).toBeGreaterThan(0);
    await expect.poll(() => warnings.join('\n')).toContain('does not match the schema');
    await expect(anyWithId(page, 'SYS-02.root')).toHaveCount(0);
  });

  test.describe('never stuck offline', () => {
    test('a gate lifts when the connection is gone, because it could never recheck', async ({ page, context, byTestId, pageErrors }) => {
      await stageAppConfig(page, MAINTENANCE);
      await page.goto(VEHICLE_PATH);
      await expect(byTestId('SYS-02.root')).toBeVisible();

      // The real thing: no stage in the way, and the browser itself offline.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await context.setOffline(true);
      await byTestId('SYS-02.state.action').click();

      // The vehicle that was asked for, in its offline state: nothing of it was loaded before the connection went.
      await expect(byTestId('VEH-01.root')).toBeVisible();
      await expect(byTestId('VEH-01.offline')).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe(VEHICLE_PATH);
      await expect(byTestId('shell.offline')).toBeVisible();
      await context.setOffline(false);
      dropStagedNetworkLogs(pageErrors);
    });

    test('a cached maintenance flag does not hold a launch without network', async ({ page, byTestId, pageErrors }) => {
      const stage = await stageAppConfig(page, MAINTENANCE);
      await page.goto('/app/discover');
      await expect(byTestId('SYS-02.root')).toBeVisible();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('sc.appConfig'))).toContain('"enabled":true');

      stage.answer = 'abort';
      await page.goto('/app/discover');

      await expect(byTestId(ROOTS.discover)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/discover');
      await expect(anyWithId(page, 'SYS-02.root').filter({ visible: true })).toHaveCount(0);
      dropStagedNetworkLogs(pageErrors);
    });

    test('a cached maintenance flag stands when the server answers 503, and lifts with a good answer', async ({ page, byTestId, pageErrors }) => {
      const stage = await stageAppConfig(page, MAINTENANCE);
      await page.goto('/app/discover');
      await expect(byTestId('SYS-02.root')).toBeVisible();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('sc.appConfig'))).toContain('"enabled":true');

      stage.answer = { status: 503 };
      const before = stage.requests;
      await page.goto('/app/discover');
      await expect(byTestId('SYS-02.root')).toBeVisible();
      await expect.poll(() => stage.requests).toBeGreaterThan(before);
      await expect(byTestId('SYS-02.state.action')).toBeEnabled();
      await expect(byTestId('SYS-02.root')).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/maintenance');

      stage.answer = OPERATING;
      await byTestId('SYS-02.state.action').click();
      await expect(byTestId(ROOTS.discover)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/discover');
      dropStagedNetworkLogs(pageErrors);
    });
  });
});

// Code review S2 (M2.8, ADR-211): web tabs stay mounted; the panes not shown are `inert`, and the focus moves into the pane shown.
test.describe('web tab panes stay mounted (S2)', () => {
  /** The testID of the one pane on screen: visible and not inert. */
  const shownPane = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="shell.tab."]')]
        .filter((el) => getComputedStyle(el).visibility === 'visible' && !el.closest('[inert]'))
        .map((el) => el.getAttribute('data-testid') ?? ''),
    );

  test('after a switch from the tab bar, the keyboard never reaches the hidden panes', async ({ page, qaGoto, byTestId, browserName }) => {
    await qaGoto('/app/');
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await byTestId('tab.discover').click();
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    const shown = await shownPane(page);
    expect(shown, 'exactly one pane on screen').toHaveLength(1);
    const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    const inPanes: string[] = [];
    for (let press = 0; press < 30; press++) {
      await page.keyboard.press(key);
      const pane = await page.evaluate(() => document.activeElement?.closest('[data-testid^="shell.tab."]')?.getAttribute('data-testid') ?? null);
      // Outside every pane is the shell (bars, header); inside one, only the pane on screen.
      if (pane !== null) inPanes.push(pane);
    }
    expect(inPanes.length, 'the keyboard reaches the pane on screen').toBeGreaterThan(0);
    expect([...new Set(inPanes)]).toEqual(shown);
  });

  test('after a switch from inside a page, the focus is not left on <body>', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/');
    // Start's rail opens the garage: a switch the tab bar did not make.
    // The row's pressable (ui/ListRow: the root holds the testID, `.body` the role).
    const rail = byTestId('HOME-01.rail.garage.open.body');
    await rail.focus();
    await expect(rail).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true);
    const pane = await page.evaluate(() => document.activeElement?.closest('[data-testid^="shell.tab."]')?.getAttribute('data-testid') ?? null);
    expect(pane === null || (await shownPane(page)).includes(pane), `the focus (${pane}) is in the pane on screen or the shell`).toBe(true);
  });

  test('axe finds nothing serious while Start is mounted and hidden', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/');
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await byTestId('tab.discover').click();
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    expect(await page.locator('[data-testid^="shell.tab."]').count(), 'Start stays mounted').toBeGreaterThan(1);
    await assertNoSeriousAxeViolations(page);
  });
});

test.describe('offline banner', () => {
  test('qaState=offline shows it on a tab root and on a pushed screen, announced', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    await qaGoto('/app/profile', { state: 'offline' });
    const banner = byTestId('shell.offline');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toHaveAttribute('aria-live', 'polite');
    await expect(banner).toContainText('Offline');

    await byTestId(`PROF-01.vehicle.${r34}`).click();
    await expect(byTestId('VEH-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(VEHICLE_PATH);
    await expect(anyWithId(page, 'tab.profile')).toHaveAttribute('aria-selected', 'true');
    await expect(byTestId('shell.offline')).toBeVisible();
  });

  test('no banner without a reason', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/discover');
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await expect(anyWithId(page, 'shell.offline')).toHaveCount(0);
  });

  test('follows the connection of the browser, in both directions', async ({ page, context, qaGoto, byTestId }) => {
    await qaGoto('/app/discover');
    await byTestId('tab.garage').click();
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    await expect(anyWithId(page, 'shell.offline')).toHaveCount(0);
    // Garage's thumbnails finish loading first: a request cut by the switch would log a failed resource that is not the app's.
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await expect(byTestId('shell.offline')).toBeVisible();
    // Discover was open before, so its chunk is here.
    await byTestId('tab.discover').click();
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await expect(byTestId('shell.offline')).toBeVisible();

    await context.setOffline(false);
    await expect(anyWithId(page, 'shell.offline').filter({ visible: true })).toHaveCount(0);
  });

  test('a tab whose chunk cannot load offline shows an error state, and the bars still work', async ({ page, context, qaGoto, byTestId, pageErrors }) => {
    await qaGoto('/app/discover');
    // Its chunk must be here before the connection goes, or Discover itself cannot load.
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await context.setOffline(true);
    await expect(byTestId('shell.offline')).toBeVisible();

    await byTestId('tab.garage').click();

    await expect(byTestId('shell.routeError')).toBeVisible();
    await expect(byTestId('shell.routeError')).toHaveAttribute('role', 'alert');
    await expect(byTestId('shell.tabbar')).toBeVisible();
    await byTestId('tab.discover').click();
    await expect(byTestId(ROOTS.discover)).toBeVisible();

    await byTestId('tab.garage').click();
    await expect(byTestId('shell.routeError')).toBeVisible();
    await context.setOffline(false);
    await byTestId('shell.routeError.action').click();
    await expect(byTestId(ROOTS.garage)).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/garage');
    dropStagedNetworkLogs(pageErrors);
  });

  test('a route outside the tabs that cannot load offline does not blank the app', async ({ page, context, qaGoto, byTestId, pageErrors }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/discover');
    // Its chunk must be here before the connection goes, or Discover itself cannot load.
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await context.setOffline(true);
    await expect(byTestId('shell.offline')).toBeVisible();

    await byTestId('shell.sidebar.signIn').click();

    await expect(byTestId('shell.routeError')).toBeVisible();
    await context.setOffline(false);
    dropStagedNetworkLogs(pageErrors);
  });
});

test.describe('not found', () => {
  for (const path of ['/app/gibt-es-nicht', `${VEHICLE_PATH}/gibt-es-nicht/auch-nicht`]) {
    test(`${path} shows SYS-03 without the tabs, and the way home works`, async ({ page, qaGoto, byTestId }) => {
      await qaGoto(path);
      await expect(byTestId('SYS-03.root')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht.' })).toBeVisible();
      await expect(page.getByRole('tablist')).toHaveCount(0);

      await byTestId('SYS-03.home').click();
      await expect(byTestId(ROOTS.home)).toBeVisible();
      await expect.poll(() => pathOf(page)).toMatch(HOME_PATH);
      await expect(anyWithId(page, 'tab.home')).toHaveAttribute('aria-selected', 'true');
    });
  }

  test('a primary button in a column of 480 centred in the window, from 768', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/gibt-es-nicht');
    const title = await byTestId('SYS-03.title').boundingBox();
    if (!title) throw new Error('no title');
    expect(title.x).toBe((1280 - 480) / 2);
    const home = await byTestId('SYS-03.home').boundingBox();
    if (!home) throw new Error('no button');
    expect(home.x).toBe(title.x);
    expect(home.height).toBe(tokens.size.button.m);
    expect(await byTestId('SYS-03.home').evaluate((node) => getComputedStyle(node.firstElementChild ?? node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await byTestId('SYS-03.title').boundingBox();
    expect(phone?.x).toBe(20);
  });

  test('speaks English too', async ({ qaGoto, byTestId }) => {
    await qaGoto('/app/gibt-es-nicht', { locale: 'en' });
    await expect(byTestId('SYS-03.home')).toHaveText('Back to home');
  });
});
