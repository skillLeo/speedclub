// Axe on the admin (M3.1): every admin route of the visual registry at 1280 in Carbon and Hell, its states in Carbon, and the shell's
// overlays opened by a key or a click. No serious or critical issue on the whole page (support/a11y.mjs). Chromium only
// (playwright.config.ts ignores axe* on WebKit). New admin routes join by being registered in visual/routes.mjs. A route that needs a
// stage fixture (ADM-F1/F2: premium.enabled; ADM-28/30 as the owner of the seeded draft: draft-owner) is checked in one test per fixture,
// with the fixture in place only for that test.
import { withFlowLock } from '../support/admin-flow';
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { tokenValues } from '../support/path-tokens.mjs';
import { STAGE_FIXTURES } from '../support/stage-fixtures.mjs';
import { ADMIN_THEMES, isAdminRoute, pathTokens, resolvePath, type RouteDef } from '../visual/matrix.mjs';
import { routes } from '../visual/routes.mjs';

const registered = (routes as RouteDef[]).filter((r) => isAdminRoute(r) && r.status !== 'planned');
const admin = registered.filter((r) => r.fixture === undefined);
/** Routes that need a stage fixture, by fixture. */
const staged = new Map<string, RouteDef[]>();
for (const r of registered) if (r.fixture !== undefined) staged.set(r.fixture, [...(staged.get(r.fixture) ?? []), r]);
/** The route's path with its seeded ids filled in (ADM-44-event: the newest seeded audit event). */
const pathOf = async (route: RouteDef): Promise<string> => {
  const names = pathTokens(route.path);
  return names.length === 0 ? route.path : resolvePath(route.path, await tokenValues(names));
};

test.describe('axe: admin routes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  for (const route of admin) {
    const expected = route.expectStatus === undefined ? [] : [{ status: route.expectStatus, url: /\/admin/ }];
    for (const theme of ADMIN_THEMES) {
      test(`${route.id} ${theme}`, async ({ page, context, qaGoto, expectFailedResponses }) => {
        expectFailedResponses(expected);
        await applyAuth(context, route.auth);
        await qaGoto(await pathOf(route), { theme });
        await expect(page.locator(`${route.ready}:visible`).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
    for (const state of route.states.filter((s) => s !== 'default')) {
      test(`${route.id} ${state}`, async ({ page, context, qaGoto, expectFailedResponses }) => {
        expectFailedResponses(expected);
        await applyAuth(context, route.auth);
        await qaGoto(await pathOf(route), { theme: 'carbon', state });
        await expect(page.locator(`${route.ready}:visible`).first()).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  }

  for (const [fixture, list] of staged) {
    test(`stage fixture ${fixture}: ${list.map((r) => r.id).join(', ')}`, async ({ page, context, qaGoto }) => {
      const stage = STAGE_FIXTURES[fixture];
      if (!stage) throw new Error(`Unknown stage fixture ${fixture}`);
      // A fixture that a flow also moves (draft-owner and A3: the seeded branding draft) waits for that flow's lock, up to 7 minutes.
      const LOCK_WAIT = 420_000;
      test.setTimeout(60_000 + list.length * 30_000 + (stage.lock ? LOCK_WAIT : 0));
      const check = async (): Promise<void> => {
        await stage.setup();
        try {
          for (const route of list) {
            await applyAuth(context, route.auth);
            for (const [theme, state] of [...ADMIN_THEMES.map((t) => [t, 'default'] as const), ...route.states.filter((s) => s !== 'default').map((s) => ['carbon', s] as const)]) {
              await test.step(`${route.id} ${theme} ${state}`, async () => {
                await qaGoto(await pathOf(route), { theme, state });
                await expect(page.locator(`${route.ready}:visible`).first()).toBeVisible();
                await assertNoSeriousAxeViolations(page);
              });
            }
          }
        } finally {
          await stage.teardown();
        }
      };
      await (stage.lock ? withFlowLock(stage.lock, LOCK_WAIT, check) : check());
    });
  }

  test('shell: the ⌘K palette open', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    await qaGoto('/admin');
    await expect(page.locator('[data-testid="ADM-06"]:visible')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('[data-testid="ADM-07.palette"]:visible')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="ADM-07.palette"]')).toHaveCount(0);
  });

  test('ADM-44: the export dialog open', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    await qaGoto('/admin/audit');
    await page.locator('[data-testid="ADM-44.table.export"]:visible').click();
    await expect(page.locator('[data-testid="ADM-44.export-dialog"]:visible')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="ADM-44.export-dialog"]:visible')).toHaveCount(0);
  });

  test('shell: the drawer navigation below 1024', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    await page.setViewportSize({ width: 768, height: 1024 });
    await qaGoto('/admin');
    await page.locator('[data-testid="shell.menu"]:visible').click();
    await expect(page.locator('[data-testid="shell.drawer"]:visible')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="shell.drawer"]:visible')).toHaveCount(0);
  });
});
