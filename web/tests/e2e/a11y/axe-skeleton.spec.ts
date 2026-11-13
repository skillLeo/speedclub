// Axe on the whole page, no serious or critical issue anywhere: the shell in each of its three bars and the states
// around it, every gallery section in every theme, and the overlays while they are open. The tablists of the bars
// exist since M1.3, so nothing is scoped out any more.
import { expect, test } from '../support/fixtures';
import { R34 } from '../support/garage.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { THEMES } from '../support/tokens.mjs';

const GALLERY_SECTIONS = [
  'typography',
  'colour',
  'foundation',
  'icons',
  'buttons',
  'inputs',
  'selection',
  'badges',
  'avatars',
  'cards',
  'rows',
  'spec',
  'states',
  'qr',
  'chat',
  'header',
  'overlays',
  'brand',
];

const BARS = [
  { width: 390, bar: 'shell.tabbar' },
  { width: 768, bar: 'shell.rail' },
  { width: 1280, bar: 'shell.sidebar' },
];

test.describe('shell', () => {
  for (const { width, bar } of BARS) {
    for (const theme of THEMES) {
      test(`${bar} at ${width}, ${theme}`, async ({ page, qaGoto, byTestId }) => {
        await page.setViewportSize({ width, height: 800 });
        await qaGoto('/app/', { theme });
        await expect(byTestId(bar)).toBeVisible();
        await expect(byTestId('HOME-01.root')).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }

    test(`pushed screen with the offline banner at ${width}`, async ({ page, qaGoto, byTestId }) => {
      await page.setViewportSize({ width, height: 800 });
      await qaGoto(`/app/v/${R34.slug}`, { state: 'offline' });
      await expect(byTestId('VEH-01.title')).toBeVisible();
      await expect(byTestId('shell.offline')).toBeVisible();
      await assertNoSeriousAxeViolations(page);
    });

    test(`auth-required sheet at ${width}`, async ({ page, qaGoto, byTestId }) => {
      await page.setViewportSize({ width, height: 800 });
      await qaGoto('/app/garage');
      // A guest's garage: the sign-in invitation opens the sheet.
      await byTestId('GAR-01.guest.action').click();
      await expect(byTestId('shell.authRequired')).toBeVisible();
      await assertNoSeriousAxeViolations(page);
    });
  }

  for (const { name, path, ready } of [
    { name: 'not found', path: '/app/gibt-es-nicht', ready: 'SYS-03.root' },
    { name: 'sign-in', path: '/app/sign-in', ready: 'AUTH-03.root' },
  ]) {
    test(name, async ({ page, qaGoto, byTestId }) => {
      await qaGoto(path);
      await expect(byTestId(ready)).toBeVisible();
      await assertNoSeriousAxeViolations(page);
    });
  }

  test('maintenance gate', async ({ page, byTestId }) => {
    await page.route('**/api/v1/app-config*', async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as { data: object };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...payload, data: { ...payload.data, maintenance: { enabled: true, message: null } } }),
      });
    });
    await page.goto('/app/');
    await expect(byTestId('SYS-02.root')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('gallery', () => {
  for (const theme of THEMES) {
    test(`index, ${theme}`, async ({ page, qaGoto }) => {
      await qaGoto('/app/dev/gallery', { theme });
      await assertNoSeriousAxeViolations(page);
    });

    for (const section of GALLERY_SECTIONS) {
      test(`${section}, ${theme}`, async ({ page, qaGoto }) => {
        await qaGoto(`/app/dev/gallery/${section}`, { theme });
        await assertNoSeriousAxeViolations(page);
      });
    }

    for (const [variant, panel] of [
      ['sheet', 'DEV-01.overlays.sheet'],
      ['sheet-form', 'DEV-01.overlays.sheetForm'],
      ['dialog', 'DEV-01.overlays.dialog'],
      ['dialog-long', 'DEV-01.overlays.dialogLong'],
      ['toast', 'DEV-01.overlays.toast'],
      ['viewer', 'DEV-01.overlays.viewer'],
    ] as const) {
      test(`overlay ${variant} open, ${theme}`, async ({ page, qaGoto, byTestId }) => {
        await qaGoto(`/app/dev/gallery/overlays?variant=${variant}`, { theme });
        await expect(byTestId(panel)).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  }
});
