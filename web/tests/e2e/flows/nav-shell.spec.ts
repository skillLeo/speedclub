// M4.5 navigation smoke (09 §6, §7.15) in the member web: the web shell is the JS one at every width (floating bar < 768,
// rail 768–1279, sidebar ≥ 1280) with the same five labels in sentence case in German and English, every tab reachable from
// every bar, the §6.5 share paths that exist open inside the shell, a path of a later module lands on the not-found page
// instead of breaking, and the web bundle never carries native tabs. Deeper bar behaviour (breakpoints, re-tap, guest, gates)
// is shell.spec.ts; native tabs, the link map and the legacy redirects are Jest (mobile/tests/shell/nativeTabs.test.ts).
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { R34 } from '../support/garage.mjs';

const TABS = ['home', 'discover', 'garage', 'messages', 'profile'] as const;
const ROOTS: Record<(typeof TABS)[number], string> = {
  home: 'HOME-01.root',
  discover: 'DISC-01.root',
  garage: 'GAR-01.root',
  messages: 'MSG-01.root',
  profile: 'PROF-01.root',
};
const LABELS = {
  de: { list: 'Hauptnavigation', tabs: ['Start', 'Entdecken', 'Garage', 'Nachrichten', 'Profil'] },
  en: { list: 'Main navigation', tabs: ['Home', 'Discover', 'Garage', 'Messages', 'Profile'] },
} as const;
const BARS = [
  { width: 390, bar: 'shell.tabbar' },
  { width: 768, bar: 'shell.rail' },
  { width: 1280, bar: 'shell.sidebar' },
] as const;

const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** The visible text of each tab in the bar, in order (a count pill would follow the label, so only the first line counts). */
async function tabLabels(page: Page, bar: string): Promise<string[]> {
  return page
    .locator(`[data-testid="${bar}"]`)
    .getByRole('tab')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText.split('\n')[0]?.trim() ?? ''));
}

for (const { width, bar } of BARS) {
  for (const locale of ['de', 'en'] as const) {
    test(`${width} ${locale}: ${bar} names the five tabs as the copy glossary does, and each one opens its root`, async ({ page, qaGoto, byTestId }) => {
      await page.setViewportSize({ width, height: 844 });
      await qaGoto('/app/', { locale });
      await expect(byTestId(ROOTS.home)).toBeVisible();
      await expect(page.locator(`[data-testid="${bar}"]`)).toHaveCount(1);
      await expect(page.getByRole('tablist', { name: LABELS[locale].list, exact: true })).toHaveCount(1);
      expect(await tabLabels(page, bar)).toEqual(LABELS[locale].tabs);

      for (const name of [...TABS.slice(1), TABS[0]]) {
        await byTestId(`tab.${name}`).click();
        await expect(byTestId(ROOTS[name])).toBeVisible();
        await expect(page.locator(`[data-testid="tab.${name}"]`)).toHaveAttribute('aria-selected', 'true');
      }
    });
  }
}

test('the share paths of 09 §6.5 that exist open inside the shell, and back returns to the tab', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/discover');
  await expect(byTestId(ROOTS.discover)).toBeVisible();
  await page.goto(`/app/v/${R34.slug}`);
  await expect(byTestId('VEH-01.root')).toBeVisible();
  await expect(page.locator('[data-testid="shell.tabbar"]')).toHaveCount(1);
  await page.goto(`/app/u/${R34.owner}`);
  await expect(byTestId('PROF-02.root')).toBeVisible();
  await page.goBack();
  await expect(byTestId('VEH-01.root')).toBeVisible();
  await page.goBack();
  await expect(byTestId(ROOTS.discover)).toBeVisible();
  expect(pathOf(page)).toBe('/app/discover');
});

test('a path of a later module (Treffen, /e/…) lands on the not-found page, not on an error', async ({ page, qaGoto, byTestId, pageErrors }) => {
  await qaGoto('/app/e/treffen-hockenheim');
  await expect(byTestId('SYS-03.root')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('the web bundle never carries native tabs (09 §6.1: platform layout files)', async ({ page, qaGoto, byTestId }) => {
  await qaGoto('/app/');
  await expect(byTestId(ROOTS.home)).toBeVisible();
  const sources = await page.evaluate(() => [...document.scripts].map((script) => script.src).filter(Boolean));
  expect(sources.length).toBeGreaterThan(0);
  for (const src of sources) {
    const body = await (await page.request.get(src)).text();
    expect(body, src).not.toContain('Nesting Native Tabs inside each other is not supported');
    expect(body, src).not.toContain('RNSTabsHost');
  }
});
