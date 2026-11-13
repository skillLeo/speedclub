// A6 ⌘K (09 §10.2, §14.5 A6), Chromium at 1280. An admin (members.view_pii, members.suspend) opens the palette with the keyboard and
// finds a test member by e-mail, a vehicle by its public id (vehicles have no plate field: SPEED CLUB never stores plates, so the public id
// in the slug is what staff type), and the vehicle's QR sticker by its code. Then the action "Mitglied sperren…": pick the member in the
// palette's second step, the member's record opens with the Sperren sheet ready, and sending it creates the four-eyes request
// (RequestMemberSuspension) — the member stays active. The palette itself never changes data. The analyst (no members.suspend) is not
// offered the action, and the action's target list answers 403 for a kind the role lacks.
import type { Page } from '@playwright/test';
import { admin, choose, confirmPasswordDirectly, DESKTOP, realClock, staffContext } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named } from '../support/flow';
import { buildVehicle } from '../support/garage.mjs';

async function palette(page: Page): Promise<void> {
  // The shell takes ⌘K and Ctrl K alike (AdminLayout).
  await page.locator('body').press('Control+K');
  await expect(id(page, 'ADM-07.palette')).toBeVisible();
}

test.describe('A6 Befehlspalette', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('⌘K finds a member by e-mail, a vehicle by its id and a QR code; "Mitglied sperren…" asks for four eyes', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const [member] = await members('a6palette');
    await named(member, 'Tom A6', 'Leipzig');
    const vehicle = await buildVehicle(member.api, { photos: 1 });
    expect(vehicle.qr, 'a published vehicle has its QR sticker').not.toBeNull();

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'admin');
    await realClock(page);
    await confirmPasswordDirectly(context);
    await page.goto('/admin');
    await expect(id(page, 'ADM-06')).toBeVisible();

    // 1. A member by e-mail (members.view_pii): the hit names the @username, never the address.
    await palette(page);
    const input = id(page, 'ADM-07.palette.input');
    await input.fill(member.email);
    const memberHit = page.locator('[data-testid="ADM-07.palette.option.record"]').filter({ hasText: `@${member.username}` });
    await expect(memberHit).toHaveCount(1);
    await expect(memberHit).not.toContainText(member.email);

    // 2. A vehicle by its public id (the slug's id part) and its QR code.
    await input.fill(vehicle.slug);
    await expect(page.locator('[data-testid="ADM-07.palette.option.record"]').filter({ hasText: `@${member.username}` })).toHaveCount(1);
    const code = vehicle.qr?.code ?? '';
    await input.fill(code);
    await expect(page.locator('[data-testid="ADM-07.palette.option.record"]').filter({ hasText: code.replace(/\s/g, '') })).toHaveCount(1);

    // 3. "Mitglied sperren…": the action, then the member, then the record with the sheet ready.
    await input.fill('sperren');
    const action = page.locator('[data-testid="ADM-07.palette.option.action"]').filter({ hasText: admin('shell', 'palette.actions.member_suspend') });
    await expect(action).toHaveCount(1);
    await input.press('Enter');
    await expect(id(page, 'ADM-07.palette.action')).toHaveText(admin('shell', 'palette.actions.member_suspend'));
    await input.fill(`@${member.username}`);
    const target = page.locator('[data-testid="ADM-07.palette.option.target"]').filter({ hasText: `@${member.username}` });
    await expect(target).toHaveCount(1);
    await input.press('Enter');
    await expect(page).toHaveURL(/\/admin\/members\/[0-9a-zA-Z]{26}\?action=suspend$/);
    await expect(id(page, 'ADM-10')).toContainText(`@${member.username}`);

    const dialog = id(page, 'ADM-10.restrict');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: new RegExp(`^${admin('decisions', 'measures.suspension')}`) })).toBeChecked();
    await expect(id(page, 'ADM-10.restrict.four-eyes')).toBeVisible();
    await choose(page, dialog, admin('decisions', 'template'), admin('decisions', 'templates.harassment.label'));
    await id(page, 'ADM-10.restrict.reason').fill('A6: Beleidigungen in drei Gesprächen, Sperre über die Palette angefragt');
    await id(page, 'ADM-10.restrict.confirm').click();
    await expect(id(page, 'shell.approval')).toBeVisible();
    await expect(id(page, 'ADM-10.status')).toHaveText(admin('members', 'status.active'));

    // 4. The analyst: no "Mitglied sperren…", no event targets.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await analystPage.goto('/admin');
      await palette(analystPage);
      await id(analystPage, 'ADM-07.palette.input').fill('sperren');
      await expect(analystPage.locator('[data-testid="ADM-07.palette.option.action"]')).toHaveCount(0);
      const refused = await analyst.request.get('/admin/palette/targets/event', { headers: { Accept: 'application/json' } });
      expect(refused.status()).toBe(403);
    } finally {
      await analyst.close();
    }
  });
});
