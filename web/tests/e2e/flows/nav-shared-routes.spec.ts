// ADR-101 on the real screens: a shared route (VEH-01 /v/[slug] in all five tabs, QR-02 /qr/[vehicleId] in Garage and Profile, ADR-164) keeps the tab that opened it,
// each tab keeps its own stack, a cold deep link lands in the first alphabetical group (Discover), back goes to the
// anchor, re-tap pops to root. The group is read from the selected tab and the URL, the screen from its root test ID.
// lukas.sc opens his R34 from Profile (PROF-01 garage strip → VEH-01) and its QR from Garage (GAR-01 card → QR-02) and
// from Profile (QR-01 row → QR-02). Native counterpart: mobile/e2e/maestro/nav-shared-routes.yaml.
import type { Locator, Page } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { demoIds, R34 } from '../support/garage.mjs';

const TABS = ['home', 'discover', 'garage', 'messages', 'profile'] as const;
type Tab = (typeof TABS)[number];
const ROOTS: Record<Tab, string> = {
  home: 'HOME-01.root',
  discover: 'DISC-01.root',
  garage: 'GAR-01.root',
  messages: 'MSG-01.root',
  profile: 'PROF-01.root',
};
const VEHICLE_PATH = `/app/v/${R34.slug}`;

const tab = (page: Page, name: Tab): Locator => page.locator(`[data-testid="tab.${name}"]`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;

async function expectActiveTab(page: Page, active: Tab): Promise<void> {
  for (const name of TABS) {
    await expect(tab(page, name), `tab.${name}`).toHaveAttribute('aria-selected', name === active ? 'true' : 'false');
  }
}

/** VEH-01 of the R34 is on screen: the screen root, its own title and its URL. */
async function expectR34(page: Page, byTestId: (id: string) => Locator): Promise<void> {
  await expect(byTestId('VEH-01.root')).toBeVisible();
  await expect(byTestId('VEH-01.title')).toHaveText('Skyline GT-R R34');
  await expect.poll(() => pathOf(page)).toBe(VEHICLE_PATH);
}

test.describe('shared routes across tabs (ADR-101)', () => {
  test('the root renders Home inside the tabs', async ({ page, byTestId }) => {
    await page.goto('/app/');
    await expect(byTestId(ROOTS.home)).toBeVisible();
    await expectActiveTab(page, 'home');
  });

  test('switching tabs changes URL, screen and selection', async ({ page, byTestId }) => {
    await page.goto('/app/');
    await expect(byTestId(ROOTS.home)).toBeVisible();
    for (const [name, url] of [
      ['discover', '/app/discover'],
      ['garage', '/app/garage'],
      ['messages', '/app/messages'],
      ['profile', '/app/profile'],
    ] as const) {
      await tab(page, name).click();
      await expect(byTestId(ROOTS[name])).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe(url);
      await expectActiveTab(page, name);
    }
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ context }) => {
      await applyAuth(context, 'member');
    });

    test('a vehicle opened from Profile stays in Profile', async ({ page, byTestId }) => {
      const { r34 } = await demoIds();
      await page.goto('/app/profile');
      await byTestId(`PROF-01.vehicle.${r34}`).click();
      await expectR34(page, byTestId);
      await expectActiveTab(page, 'profile');
    });

    test('the same QR page opened from Garage stays in Garage, and from Profile in Profile', async ({ page, byTestId }) => {
      const { r34 } = await demoIds();
      await page.goto('/app/garage');
      await byTestId(`GAR-01.card.${r34}.qr`).click();
      await expect(byTestId('QR-02.root')).toBeVisible();
      await expect(byTestId('QR-02.card.shortCode')).toHaveText(R34.shortCode);
      await expect.poll(() => pathOf(page)).toBe(`/app/qr/${r34}`);
      await expectActiveTab(page, 'garage');

      await tab(page, 'profile').click();
      await byTestId('PROF-01.qrCodes').click();
      await byTestId(`QR-01.row.${r34}.body`).click();
      await expect(byTestId('QR-02.card.shortCode')).toHaveText(R34.shortCode);
      await expect.poll(() => pathOf(page)).toBe(`/app/qr/${r34}`);
      await expectActiveTab(page, 'profile');
    });

    // DQ-171, ADR-164: an owner screen belongs to an owner tab, not to the first alphabetical group.
    for (const [suffix, root] of [
      ['', 'QR-02.root'],
      ['/placement', 'QR-03.root'],
      ['/preview', 'QR-04.root'],
    ] as const) {
      test(`a cold link to /qr/{id}${suffix} highlights Garage and keeps its address`, async ({ page, byTestId }) => {
        const { r34 } = await demoIds();
        await page.goto(`/app/qr/${r34}${suffix}`);
        await expect(byTestId(root)).toBeVisible();
        await expect.poll(() => pathOf(page)).toBe(`/app/qr/${r34}${suffix}`);
        await expectActiveTab(page, 'garage');
      });
    }

    test('back from a cold link to a QR page reaches the root of Garage', async ({ page, byTestId }) => {
      const { r34 } = await demoIds();
      await page.goto(`/app/qr/${r34}`);
      await expect(byTestId('QR-02.root')).toBeVisible();
      await byTestId('QR-02.header.back').click();
      await expect(byTestId(ROOTS.garage)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/garage');
      await expectActiveTab(page, 'garage');
    });

    // DQ-202, ADR-160: the large title stays put between the tabs on desktop.
    for (const width of [1280, 1440]) {
      test(`the large title of every tab root starts at the same place at ${width}`, async ({ page, byTestId }) => {
        await page.setViewportSize({ width, height: 800 });
        const titles = { home: 'HOME-01.title', discover: 'DISC-01.title', garage: 'GAR-01.title', messages: 'MSG-01.title', profile: 'PROF-01.title' };
        await page.goto('/app/');
        for (const name of TABS) {
          await tab(page, name).click();
          const title = byTestId(titles[name]);
          await expect(title).toBeVisible();
          const start = await title.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getBoundingClientRect().x;
          });
          expect(start, name).toBe(264);
        }
      });
    }

    test('each tab keeps its own stack', async ({ page, byTestId }) => {
      const { r34 } = await demoIds();
      await page.goto('/app/profile');
      await byTestId(`PROF-01.vehicle.${r34}`).click();
      await expectR34(page, byTestId);

      await tab(page, 'garage').click();
      await expect(byTestId(ROOTS.garage)).toBeVisible();
      await byTestId(`GAR-01.card.${r34}.qr`).click();
      await expect(byTestId('QR-02.root')).toBeVisible();
      await expectActiveTab(page, 'garage');

      await tab(page, 'profile').click();
      await expectR34(page, byTestId);
      await expectActiveTab(page, 'profile');

      await byTestId('VEH-01.header.back').click();
      await expect(byTestId(ROOTS.profile)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/profile');

      await tab(page, 'garage').click();
      await expect(byTestId('QR-02.root'), 'Garage is unaffected by back in Profile').toBeVisible();
      await expect.poll(() => pathOf(page)).toBe(`/app/qr/${r34}`);
      await expectActiveTab(page, 'garage');
    });

    test('re-tapping the active tab pops to its root', async ({ page, byTestId }) => {
      const { r34 } = await demoIds();
      await page.goto('/app/garage');
      await byTestId(`GAR-01.card.${r34}`).click();
      await expect(byTestId('GAR-02.root')).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe(`/app/garage/${r34}`);

      await tab(page, 'garage').click();
      await expect(byTestId(ROOTS.garage)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/garage');
      await expectActiveTab(page, 'garage');
    });

    test('browser back returns from a pushed vehicle', async ({ page, byTestId }) => {
      const { r34 } = await demoIds();
      await page.goto('/app/profile');
      await byTestId(`PROF-01.vehicle.${r34}`).click();
      await expectR34(page, byTestId);
      await page.goBack();
      await expect(byTestId(ROOTS.profile)).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/profile');
      await expectActiveTab(page, 'profile');
    });
  });

  test('a cold deep link lands in Discover and back goes to the anchor', async ({ page, byTestId }) => {
    await page.goto(VEHICLE_PATH);
    await expectR34(page, byTestId);
    await expectActiveTab(page, 'discover');

    await byTestId('VEH-01.header.back').click();
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/discover');
  });

  test('reloading a deep link keeps the page', async ({ page, byTestId }) => {
    await page.goto('/app/discover');
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await page.reload();
    await expect(byTestId(ROOTS.discover)).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/discover');
    await expectActiveTab(page, 'discover');

    await page.goto(VEHICLE_PATH);
    await expectR34(page, byTestId);
    await page.reload();
    await expectR34(page, byTestId);
  });
});
