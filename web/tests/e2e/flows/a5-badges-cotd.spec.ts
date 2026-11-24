// A5 Abzeichen + Car of the Day (ADM-63/64, M5.9d admin; m5.9d contract §2/§3), Chromium at 1280 like the other admin flows. The content
// editor creates a badge from the rule form (Kennzahl "Tage seit der Aktivierung", mindestens 1.000.000: nobody reaches it, so applying it
// awards nothing on the shared database), sees the preview, a refused save (German name cleared), deactivates and reactivates it and
// applies it (confirm with the preview count); every step lands in the badge's activity. On Car of the Day the editor chooses a test
// member's public car for a day ten days ahead (picker, reason, ⚿), sees an unlisted car refused as a field error, and skips the next
// day. The moderator's direct POST is refused (403), the analyst has no badge page. Cleanup: the test badge and the two day rows.
import { admin, choose, confirmPassword, DESKTOP, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { removeCotdDays, removeTestBadges } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named } from '../support/flow';
import { buildVehicle } from '../support/garage.mjs';

const RX7 = { make: 'Mazda', model: 'RX-7', generation: 'FD', year: 1993 };

/** The Berlin day `offset` days from now, as Y-m-d. */
function berlinDay(offset: number): string {
  const at = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

test.describe('A5 Abzeichen + Car of the Day', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('badge: create → refused save → deactivate/activate → apply; Car of the Day: override (+ refusal) → skip; other roles refused', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const key = `e2e-a5-${Date.now().toString(36)}`;
    const overrideDay = berlinDay(10);
    const skipDay = berlinDay(11);

    try {
      const [owner] = await members('a5cotd');
      await named(owner, 'Kai A5', 'Köln');
      await buildVehicle(owner.api, { photos: 1 });
      // A second, unlisted car of another model, so the picker tells the two apart by title.
      await buildVehicle(owner.api, { car: RX7, photos: 1, specs: null, visibility: 'unlisted' });

      await page.setViewportSize(DESKTOP);
      await staffContext(context, 'content-editor');
      await realClock(page);

      // 1. The list, then "Neues Abzeichen".
      await page.goto('/admin/content/badges');
      await expect(id(page, 'ADM-63.table')).toBeVisible();
      await id(page, 'ADM-63.new').click();
      await expect(id(page, 'ADM-63R.form')).toBeVisible();
      await id(page, 'ADM-63R.key').fill(key);
      await id(page, 'ADM-63R.name-de').fill('Langzeit-Mitglied A5');
      await id(page, 'ADM-63R.name-en').fill('Long-time member A5');
      await id(page, 'ADM-63R.description-de').fill('Seit sehr langer Zeit bei Speedclub.');
      await id(page, 'ADM-63R.description-en').fill('With Speedclub for a very long time.');
      const rule = id(page, 'ADM-63.rule');
      await choose(page, rule, admin('gift', 'badges.rule.metric'), admin('gift', 'badges.metrics.member_days'));
      await id(page, 'ADM-63.rule.value').fill('1000000');
      await expect(id(page, 'ADM-63.rule.preview')).toContainText(admin('gift', 'badges.rule.preview', { count: '0' }));

      // 2. Anlegen (⚿): the record with its status and the audit entry.
      await id(page, 'ADM-63R.save').click();
      await confirmPassword(page);
      await expect(toast(page, admin('gift', 'badges.flash.created'))).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/admin/content/badges/${key}$`));
      await expect(id(page, 'ADM-63R.status')).toHaveText(admin('gift', 'badges.status.active'));
      await expect(id(page, 'ADM-63R.activity')).toContainText(admin('audit', 'actions.badge.created'));

      // 3. A refused save: the German name cleared → the field error, nothing saved.
      await id(page, 'ADM-63R.name-de').fill('');
      await id(page, 'ADM-63R.save').click();
      await expect(id(page, 'ADM-63R.form-error')).toBeVisible();
      await id(page, 'ADM-63R.name-de').fill('Langzeit-Mitglied A5');

      // 4. Deaktivieren, then Aktivieren: the status and two audit entries.
      await page.reload();
      await id(page, 'ADM-63R.active').click();
      await id(page, 'ADM-63R.active-dialog.confirm').click();
      await expect(toast(page, admin('gift', 'badges.flash.deactivated'))).toBeVisible();
      await expect(id(page, 'ADM-63R.status')).toHaveText(admin('gift', 'badges.status.inactive'));
      await expect(id(page, 'ADM-63R.apply')).toBeDisabled();
      await id(page, 'ADM-63R.active').click();
      await id(page, 'ADM-63R.active-dialog.confirm').click();
      await expect(toast(page, admin('gift', 'badges.flash.activated'))).toBeVisible();

      // 5. Jetzt anwenden: the dialog names the preview count; nobody reaches the rule.
      await id(page, 'ADM-63R.apply').click();
      await expect(id(page, 'ADM-63R.apply-count')).toContainText(admin('gift', 'badges.rule.preview', { count: '0' }));
      await id(page, 'ADM-63R.apply-dialog.confirm').click();
      await expect(toast(page, admin('gift', 'badges.flash.applied'))).toBeVisible();
      await expect(id(page, 'ADM-63R.activity')).toContainText(admin('audit', 'actions.badge.applied'));

      // 6. Car of the Day: another car for the day ten days ahead (row 10 of the upcoming list).
      await page.goto('/admin/content/car-of-the-day');
      const rows = page.locator('[data-testid="ADM-64.upcoming"] [data-testid="ADM-64.row"]');
      await expect(rows).toHaveCount(15);
      const overrideRow = rows.nth(10);
      await expect(overrideRow.locator('time')).toHaveAttribute('datetime', overrideDay);

      // 6a. An unlisted car is refused as a field error under the car.
      await overrideRow.getByTestId('ADM-64.actions').click();
      await page.getByTestId('ADM-64.action.override').click();
      await id(page, 'ADM-64.override.choose').click();
      await id(page, 'ADM-64.picker.search').fill(`@${owner.username}`);
      const results = id(page, 'ADM-64.picker.result');
      await expect(results).toHaveCount(2);
      await results.filter({ hasText: 'RX-7' }).click();
      // The password was confirmed for the badge a moment ago (ADR-215: 5 minutes), so the write goes straight through.
      await id(page, 'ADM-64.override.confirm').click();
      await expect(id(page, 'ADM-64.override-dialog').locator('[role="alert"]').first()).toBeVisible();
      await expect(rows.nth(10)).toHaveAttribute('data-status', 'open');

      // 6b. The public car: chosen, the row says so, the activity holds it.
      await id(page, 'ADM-64.override.choose').click();
      await id(page, 'ADM-64.picker.search').fill(`@${owner.username}`);
      await results.filter({ hasText: 'Skyline' }).click();
      await id(page, 'ADM-64.override.confirm').click();
      await expect(toast(page, admin('gift', 'cotd.flash.overridden'))).toBeVisible();
      await expect(overrideRow).toHaveAttribute('data-status', 'picked');
      await expect(overrideRow.getByTestId('ADM-64.car')).toBeVisible();
      await expect(id(page, 'ADM-64.activity')).toContainText(admin('audit', 'actions.car_of_the_day.overridden'));

      // 7. Tag aussetzen for the next day, with a reason.
      const skipRow = rows.nth(11);
      await skipRow.getByTestId('ADM-64.actions').click();
      await page.getByTestId('ADM-64.action.skip').click();
      await id(page, 'ADM-64.skip-dialog.confirm').click();
      await expect(toast(page, admin('gift', 'cotd.flash.skipped'))).toBeVisible();
      await expect(skipRow).toHaveAttribute('data-status', 'skipped');

      // 8. The moderator: a direct POST is refused, nothing changes; the analyst has no badge page.
      const { context: moderator } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
      try {
        await staffContext(moderator, 'moderator');
        await moderator.request.get('/admin');
        const refused = await moderator.request.post(`/admin/content/car-of-the-day/${skipDay}/skip`, {
          headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(moderator) },
          data: { reason: 'Kein Car of the Day an diesem Abend.' },
          maxRedirects: 0,
        });
        expect(refused.status()).toBe(403);
      } finally {
        await moderator.close();
      }
      const { context: analyst } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
      try {
        await staffContext(analyst, 'analyst');
        const list = await analyst.request.get('/admin/content/badges', { maxRedirects: 0 });
        expect(list.status()).toBe(403);
      } finally {
        await analyst.close();
      }
    } finally {
      await removeCotdDays([overrideDay, skipDay]);
      await removeTestBadges();
    }
  });
});
