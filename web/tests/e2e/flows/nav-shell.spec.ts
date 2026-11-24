// M4.5 navigation smoke (09 §6, §7.15), Navigation 3.0 since M5.2 (10 §1, ADR-501), in the member web: the web shell is the JS one at every
// width (floating bar < 768 with the five tabs Start · Entdecken · Garage · Shop · Profil, rail 768–1279 adding Nachrichten, sidebar
// ≥ 1280 with Start · Entdecken · Treffen · (Forum) · Garage · Shop · Nachrichten · Profil) in sentence case in German and English, every
// item reachable from every bar, Nachrichten as the header link of Start and Entdecken on phones, Entdecken's segments Builds · Treffen
// with a deep link each, the §6.5 share paths that exist open inside the shell, a path of a later module lands on the not-found page
// instead of breaking, and the web bundle never carries native tabs. Deeper bar behaviour (breakpoints, re-tap, guest, gates) is
// shell.spec.ts; native tabs, the link map and the legacy redirects are Jest (mobile/tests/shell/nativeTabs.test.ts, navigation3.test.tsx).
import type { Page } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { R34 } from '../support/garage.mjs';

const ROOTS: Record<string, string> = {
  'tab.home': 'HOME-01.root',
  'tab.discover': 'DISC-01.root',
  'tab.garage': 'GAR-01.root',
  'tab.shop': 'SHOP-01.root',
  'tab.profile': 'PROF-01.root',
  'shell.place.messages': 'MSG-01.root',
  'shell.place.events': 'EVT-01.root',
  'shell.place.forum': 'FOR-01.root',
  'shell.place.crews': 'CREW-00.root',
};
const PATHS: Record<string, string> = {
  'tab.home': '/app/',
  'tab.discover': '/app/discover',
  'tab.garage': '/app/garage',
  'tab.shop': '/app/shop',
  'tab.profile': '/app/profile',
  'shell.place.messages': '/app/messages',
  'shell.place.events': '/app/events',
  'shell.place.forum': '/app/forum',
  'shell.place.crews': '/app/crews',
};
const ROOTS_DISCOVER = 'DISC-01.root';
/** Each bar's items and their labels. `events` and `crews` (11 R4-2.3) are on locally and on staging; `forum` is on in every environment since M5.8 (ADR-506). */
const BARS = [
  {
    width: 390,
    bar: 'shell.tabbar',
    items: ['tab.home', 'tab.discover', 'tab.garage', 'tab.shop', 'tab.profile'],
    de: ['Start', 'Entdecken', 'Garage', 'Shop', 'Profil'],
    en: ['Home', 'Discover', 'Garage', 'Shop', 'Profile'],
  },
  {
    width: 768,
    bar: 'shell.rail',
    items: ['tab.home', 'tab.discover', 'tab.garage', 'tab.shop', 'shell.place.messages', 'tab.profile'],
    de: ['Start', 'Entdecken', 'Garage', 'Shop', 'Nachrichten', 'Profil'],
    en: ['Home', 'Discover', 'Garage', 'Shop', 'Messages', 'Profile'],
  },
  {
    width: 1280,
    bar: 'shell.sidebar',
    items: ['tab.home', 'tab.discover', 'shell.place.events', 'shell.place.forum', 'shell.place.crews', 'tab.garage', 'tab.shop', 'shell.place.messages', 'tab.profile'],
    de: ['Start', 'Entdecken', 'Treffen', 'Forum', 'Crews', 'Garage', 'Shop', 'Nachrichten', 'Profil'],
    en: ['Home', 'Discover', 'Meets', 'Forum', 'Crews', 'Garage', 'Shop', 'Messages', 'Profile'],
  },
] as const;
const LIST_NAME = { de: 'Hauptnavigation', en: 'Main navigation' } as const;

const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** The visible text of each item in the bar, in order (a count pill would follow the label, so only the first line counts). */
async function tabLabels(page: Page, bar: string): Promise<string[]> {
  return page
    .locator(`[data-testid="${bar}"]`)
    .getByRole('tab')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText.split('\n')[0]?.trim() ?? ''));
}

for (const { width, bar, items, ...labels } of BARS) {
  for (const locale of ['de', 'en'] as const) {
    test(`${width} ${locale}: ${bar} names its items as 10 §1 and the copy glossary do, and each one opens its page`, async ({ page, qaGoto, byTestId }) => {
      await page.setViewportSize({ width, height: 844 });
      await qaGoto('/app/', { locale });
      await expect(byTestId(ROOTS['tab.home'] as string)).toBeVisible();
      await expect(page.locator(`[data-testid="${bar}"]`)).toHaveCount(1);
      await expect(page.getByRole('tablist', { name: LIST_NAME[locale], exact: true })).toHaveCount(1);
      expect(await tabLabels(page, bar)).toEqual([...labels[locale]]);

      for (const item of [...items.slice(1), items[0]]) {
        await byTestId(item).click();
        await expect(byTestId(ROOTS[item] as string)).toBeVisible();
        await expect.poll(() => pathOf(page).replace(/\/$/, '')).toBe((PATHS[item] as string).replace(/\/$/, ''));
        await expect(page.locator(`[data-testid="${item}"]`)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(`[data-testid="${bar}"]`).getByRole('tab', { selected: true })).toHaveCount(1);
      }
    });
  }
}

test.describe('Nachrichten in the header (10 §1)', () => {
  test('390: Start and Entdecken link to Nachrichten next to the bell, and back returns', async ({ context, page, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/');
    const link = byTestId('HOME-01.messages');
    await expect(link).toHaveAttribute('role', 'link');
    await expect(link).toHaveAccessibleName(/^Nachrichten/);
    await link.click();
    await expect(byTestId('MSG-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/messages');
    await expect(page.locator('[data-testid="tab.home"]')).toHaveAttribute('aria-selected', 'true');
    await byTestId('MSG-01.header.back').click();
    await expect(byTestId('HOME-01.root')).toBeVisible();

    await byTestId('tab.discover').click();
    await byTestId('DISC-01.messages').click();
    await expect(byTestId('MSG-01.root')).toBeVisible();
    await expect(page.locator('[data-testid="tab.discover"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('390: a guest is asked to sign in first, as by the bell (DQ-M52-16)', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/');
    await byTestId('HOME-01.messages').click();
    await expect(byTestId('shell.authRequired')).toBeVisible();
    expect(pathOf(page)).toBe('/app/');
  });

  test('768: the rail lists Nachrichten, so the header does not', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 768, height: 844 });
    await qaGoto('/app/');
    await expect(byTestId('HOME-01.bell')).toBeVisible();
    await expect(page.locator('[data-testid="HOME-01.messages"]')).toHaveCount(0);
  });

  test('old message links keep working', async ({ page, qaGoto, byTestId }) => {
    await qaGoto('/app/messages?folder=requests');
    await expect(byTestId('MSG-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/messages');
  });
});

test.describe('Entdecken › Builds · Treffen (10 §1)', () => {
  test('the segmented control swaps Builds and Treffen in place, each with its own address and search', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/discover');
    await expect(byTestId('DISC-01.segments.builds')).toHaveAttribute('aria-selected', 'true');
    await expect(byTestId('DISC-01.search')).toBeVisible();
    await byTestId('DISC-01.segments.events').click();
    await expect(byTestId('EVT-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/events');
    await expect(byTestId('EVT-01.segments.events')).toHaveAttribute('aria-selected', 'true');
    await expect(byTestId('EVT-01.search')).toBeVisible();
    // A segment page has no back: it is Entdecken itself.
    await expect(page.locator('[data-testid="EVT-01.header.back"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tab.discover"]')).toHaveAttribute('aria-selected', 'true');
    await byTestId('EVT-01.segments.builds').click();
    await expect(byTestId(ROOTS_DISCOVER)).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/discover');
  });

  test('a deep link to /events opens Entdecken on Treffen', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/events');
    await expect(byTestId('EVT-01.segments.events')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="tab.discover"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('Builds stays below Treffen: its typed search survives the way there and back (review SF-2)', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/discover');
    await byTestId('DISC-01.search').fill('e46');
    // DQ-M52-04: the scope chips show once something is typed.
    await expect(byTestId('DISC-01.scope.vehicles')).toBeVisible();
    await byTestId('DISC-01.segments.events').click();
    await expect(byTestId('EVT-01.root')).toBeVisible();
    await byTestId('EVT-01.segments.builds').click();
    await expect.poll(() => pathOf(page)).toBe('/app/discover');
    await expect(byTestId('DISC-01.search')).toHaveValue('e46');
  });

  test('1280: the sidebar lists Treffen, so the page is titled Treffen and has no segmented control (DQ-M52-03)', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await qaGoto('/app/events');
    await expect(byTestId('EVT-01.root')).toBeVisible();
    await expect(byTestId('EVT-01.title')).toHaveText('Treffen');
    await expect(page.locator('[data-testid="EVT-01.segments"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="shell.place.events"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('390: Treffen has one Karte toggle at the end of its search row, and the title stays in the map (DQ-M52-05/06)', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/events');
    await expect(page.locator('[data-testid="EVT-01.view"]')).toHaveCount(0);
    const titleTop = (await byTestId('EVT-01.title').boundingBox())?.y;
    await byTestId('EVT-01.view.map').click();
    await expect(byTestId('EVT-01.view.list')).toBeVisible();
    await expect(byTestId('EVT-01.title')).toBeVisible();
    expect((await byTestId('EVT-01.title').boundingBox())?.y).toBe(titleTop);
  });

  test('a swipe to the left on Builds opens Treffen', async ({ page, qaGoto, byTestId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await qaGoto('/app/discover');
    const box = await byTestId('DISC-01.swipe').boundingBox();
    if (!box) throw new Error('no swipe area');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    for (const step of [20, 60, 120, 200, 280]) await page.mouse.move(box.x + box.width - 40 - step, y);
    await page.mouse.up();
    await expect(byTestId('EVT-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/events');
  });
});

test('the share paths of 09 §6.5 that exist open inside the shell, and back returns to the tab', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/discover');
  await expect(byTestId(ROOTS_DISCOVER)).toBeVisible();
  await page.goto(`/app/v/${R34.slug}`);
  await expect(byTestId('VEH-01.root')).toBeVisible();
  await expect(page.locator('[data-testid="shell.tabbar"]')).toHaveCount(1);
  await page.goto(`/app/u/${R34.owner}`);
  await expect(byTestId('PROF-02.root')).toBeVisible();
  await page.goBack();
  await expect(byTestId('VEH-01.root')).toBeVisible();
  await page.goBack();
  await expect(byTestId(ROOTS_DISCOVER)).toBeVisible();
  expect(pathOf(page)).toBe('/app/discover');
});

test('a path of a later module (Treffen, /e/…) lands on the not-found page, not on an error', async ({ page, qaGoto, byTestId, pageErrors }) => {
  await qaGoto('/app/e/treffen-hockenheim');
  await expect(byTestId('SYS-03.root')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('the web bundle never carries native tabs (09 §6.1: platform layout files)', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/');
  await expect(byTestId(ROOTS['tab.home'] as string)).toBeVisible();
  const sources = await page.evaluate(() => [...document.scripts].map((script) => script.src).filter(Boolean));
  expect(sources.length).toBeGreaterThan(0);
  for (const src of sources) {
    const body = await (await page.request.get(src)).text();
    expect(body, src).not.toContain('Nesting Native Tabs inside each other is not supported');
    expect(body, src).not.toContain('RNSTabsHost');
  }
});
