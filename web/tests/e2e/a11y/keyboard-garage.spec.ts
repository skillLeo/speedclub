// Keyboard access to the M1.6 screens on the member web: reordering with the handle and the arrow keys on GAR-01 (vehicles),
// GAR-07 (photos, a 3-column grid) and GAR-09 (mods within their category), each move announced and saved with "Fertig";
// the focus order of the wizard's first step follows what the eye reads; and the image viewer (VEH-04) holds focus while
// open and gives it back to the photo that opened it.
//
// Each reorder test has a member of its own under E2E_DOMAIN whose garage is built through the API (support/garage.mjs).
import type { Locator, Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { recordFocusOrder } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { BBS_WHEELS, buildVehicle, createGarageMember, expectStatus, R34 } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const activeTestId = (page: Page): Promise<string> => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');

/** Tabs forward until `testId` has focus: proof that it is in the tab order, not only focusable by script. */
async function tabTo(page: Page, testId: string, key: string, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if ((await activeTestId(page)) === testId) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${testId} never got focus within ${max} presses of ${key}`);
}

const tabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

test.describe('reorder with the keyboard', () => {
  // Each test builds its garage through the API first, photos uploaded for real: a ceiling for a busy machine, where the
  // full suite ran GAR-01 out of its 60 s.
  test.slow();

  test('GAR-01: the arrow keys move a vehicle, the main one stays on top, and "Fertig" saves the order', async ({ page, browserName }) => {
    const member = await createGarageMember('kbgarage');
    const main = await buildVehicle(member.api, { nickname: 'Erster' });
    const second = await buildVehicle(member.api, { nickname: 'Zweiter' });
    const third = await buildVehicle(member.api, { nickname: 'Dritter' });
    await useSession(page.context(), member.session);
    await page.goto(qaUrl('/app/garage'));
    await expect(id(page, `GAR-01.card.${third.id}`)).toBeVisible();

    await id(page, 'GAR-01.sort').click();
    await expect(id(page, 'GAR-01.sortHint')).toContainText('Pfeiltasten');
    await expect(page.locator(`[data-testid="GAR-01.sortable.${main.id}.handle"]`), 'the main vehicle has no handle').toHaveCount(0);
    const handle = `GAR-01.sortable.${second.id}.handle`;
    await page.locator('body').focus();
    await tabTo(page, handle, tabKey(browserName));
    await expect(id(page, handle)).toHaveAttribute('role', 'button');
    await expect(id(page, handle)).toHaveAttribute('aria-label', /verschieben$/);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-testid="GAR-01.sortable.announcement"]')).toHaveText(/: Platz 2 von 2$/);
    await expect(page.locator(`[data-testid="${handle}"]`), 'focus stays on the moved handle').toBeFocused();

    await id(page, 'GAR-01.sortDone').click();
    await expect(id(page, 'GAR-01.toast')).toHaveText('Reihenfolge gespeichert');
    const order = expectStatus(await member.api.get('me/vehicles'), 200, 'GET me/vehicles').data.map((v: { id: string }) => v.id);
    expect(order).toEqual([main.id, third.id, second.id]);
  });

  test('GAR-07: the arrow keys move a photo in the grid, and the new order is saved', async ({ page, browserName }) => {
    const member = await createGarageMember('kbphotos');
    const vehicle = await buildVehicle(member.api, { photos: 3 });
    const [a, b, c] = vehicle.photos.map((p) => p.id) as [string, string, string];
    await useSession(page.context(), member.session);
    await page.goto(qaUrl(`/app/garage/${vehicle.id}/photos`));
    await expect(id(page, 'GAR-07.photos')).toBeVisible();

    await id(page, 'GAR-07.sort').click();
    const handle = `GAR-07.sortable.${a}.handle`;
    await page.locator('body').focus();
    await tabTo(page, handle, tabKey(browserName));
    // A 3-column grid: right is one place on, down is a row on.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-testid="GAR-07.sortable.announcement"]')).toHaveText(/: Platz 2 von 3$/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-testid="GAR-07.sortable.announcement"]')).toHaveText(/: Platz 3 von 3$/);
    await id(page, 'GAR-07.sortDone').click();
    await expect(id(page, 'GAR-07.toast')).toHaveText('Reihenfolge gespeichert');
    const photos = expectStatus(await member.api.get(`vehicles/${vehicle.id}`), 200, 'GET vehicle').data.photos.map((p: { id: string }) => p.id);
    expect(photos).toEqual([b, c, a]);
  });

  test('GAR-09: the arrow keys move a mod within its category, and the new order is saved', async ({ page, browserName }) => {
    const member = await createGarageMember('kbmods');
    const vehicle = await buildVehicle(member.api, {
      mods: [BBS_WHEELS, { ...BBS_WHEELS, fields: { ...BBS_WHEELS.fields, wheel_model: 'RS' } }],
    });
    const [lm, rs] = vehicle.mods.map((m) => m.id) as [string, string];
    await useSession(page.context(), member.session);
    await page.goto(qaUrl(`/app/garage/${vehicle.id}/mods`));
    await expect(id(page, `GAR-09.mod.${rs}`)).toBeVisible();

    await id(page, 'GAR-09.sort').click();
    const handle = `GAR-09.sortable.wheels_tires.${lm}.handle`;
    await page.locator('body').focus();
    await tabTo(page, handle, tabKey(browserName));
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-testid="GAR-09.sortable.wheels_tires.announcement"]')).toHaveText(/^BBS LM: Platz 2 von 2$/);
    await id(page, 'GAR-09.sortDone').click();
    await expect(id(page, 'GAR-09.toast')).toHaveText('Reihenfolge gespeichert');
    const mods = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data.map((m: { id: string }) => m.id);
    expect(mods).toEqual([rs, lm]);
  });
});

test.describe('focus order', () => {
  test('wizard step 1: close, then the fields top to bottom, then the bar', async ({ page, browserName }) => {
    const member = await createGarageMember('kbwizard');
    await useSession(page.context(), member.session);
    await page.goto(qaUrl('/app/add-vehicle/new/vehicle'));
    await expect(id(page, 'GAR-03.make')).toBeVisible();
    await page.locator('body').focus();
    const order = (await recordFocusOrder(page, 14, { key: tabKey(browserName) })).filter((entry) => entry.startsWith('GAR-03.'));
    const expected = ['GAR-03.header.back', 'GAR-03.make', 'GAR-03.year', 'GAR-03.vehicle.saveDraft', 'GAR-03.vehicle.cta.primary'];
    const seen = expected.map((testId) => order.indexOf(testId));
    expect(seen.every((index) => index >= 0), `focus order: ${order.join(' → ')}`).toBe(true);
    expect([...seen].sort((x, y) => x - y), `focus order: ${order.join(' → ')}`).toEqual(seen);
    // The visual order of the fields is the order of the tab stops.
    const tops = await Promise.all(['GAR-03.make', 'GAR-03.year'].map(async (t) => (await id(page, t).boundingBox())?.y ?? NaN));
    expect(tops[0]).toBeLessThan(tops[1] as number);
  });

  test('VEH-04: the viewer holds focus while open, Escape closes it and focus returns to the photo', async ({ page, browserName }) => {
    await page.goto(qaUrl(`/app/v/${R34.slug}`));
    const opener = id(page, 'VEH-01.hero.0');
    await expect(opener).toBeVisible();
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(id(page, 'VEH-04.viewer')).toBeVisible();
    await expect(id(page, 'VEH-04.viewer.counter')).toHaveText('1/3');

    // Focus stays inside the modal dialog that holds the viewer, whatever its first stop is, and reaches the close button.
    const stops: { testId: string; inDialog: boolean }[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(tabKey(browserName));
      stops.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          const dialog = document.querySelector('[data-testid="VEH-04.viewer"]')?.closest('[aria-modal="true"]');
          return { testId: active?.getAttribute('data-testid') ?? active?.tagName.toLowerCase() ?? 'none', inDialog: Boolean(dialog && active && dialog.contains(active)) };
        }),
      );
    }
    const trail = stops.map((s) => `${s.testId}${s.inDialog ? '' : ' (outside)'}`).join(' → ');
    expect(stops.every((s) => s.inDialog), `focus left the viewer: ${trail}`).toBe(true);
    expect(stops.map((s) => s.testId), trail).toContain('VEH-04.viewer.close');

    await page.keyboard.press('ArrowRight');
    await expect(id(page, 'VEH-04.viewer.counter')).toHaveText('2/3');
    await page.keyboard.press('Escape');
    await expect(id(page, 'VEH-04.viewer')).toHaveCount(0);
    await expect(page.locator('[data-testid="VEH-01.hero.0"]')).toBeFocused();
  });
});
