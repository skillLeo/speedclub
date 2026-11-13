// A5 Betriebs-Anträge (09 §10.2 SplitQueue, §10.3 ADM-55/56, §14.5 A5; ADR-455), Chromium at 1280 like the other admin flows. Two test
// members apply with a business through the member API (POST me/business, as BIZ-02 sends it). The moderator works ADM-55 by keyboard
// only: opens the first application in the pane (the Impressum staff check), verifies it with `a`, takes it back with `u` within the
// 5 s, moves with `j`, rejects the second with `r` and a reason the applicant reads in GET me/business, then verifies the first again.
// On ADM-56 "Sperren" is four-eyes: it only creates the `business.suspend` request (the notice says so; the business stays verified).
// The analyst sees the queue read-only and a direct POST answers 403. parts_catalogue and businesses are switched on for the run and off
// after (support/backend.php m414FlagsFixture), as F13 does.
import type { Page } from '@playwright/test';
import { admin, confirmPasswordDirectly, DESKTOP, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { disableM414Flags, enableM414Flags } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named, type Member } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type Mine = { id: string; slug: string; name: string; status: string; status_reason: string | null };

async function apply(member: Member, name: string): Promise<Mine> {
  return expectStatus(
    await member.api.post('me/business', {
      name,
      kind: 'workshop',
      legal_name: `${name} GmbH`,
      legal_form: 'gmbh',
      representative: 'Jana Petersen',
      street: 'Hafenstraße 12',
      postcode: '20359',
      city: 'Hamburg',
      email: 'kontakt@a5-werkstatt.test',
      register_court: 'Amtsgericht Hamburg',
      register_number: 'HRB 123456',
      services: ['Fahrwerk', 'Achsvermessung'],
      opening_hours: { mon: [['08:00', '17:00']], sat: [['09:00', '12:00']] },
      accept_terms: true,
    }),
    201,
    `POST me/business ${name}`,
  ).data as Mine;
}

async function mine(member: Member): Promise<Mine> {
  return expectStatus(await member.api.get('me/business'), 200, 'GET me/business').data as Mine;
}

async function openQueue(page: Page, prefix: string): Promise<void> {
  await page.goto(`/admin/businesses?${new URLSearchParams({ 'filter[q]': prefix }).toString()}`);
  await expect(id(page, 'ADM-55.table')).toBeVisible();
}

test.describe('A5 Betriebs-Anträge', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');
  test.beforeAll(async () => {
    await enableM414Flags();
  });
  test.afterAll(async () => {
    await disableM414Flags();
  });

  test('pane → a (verify) → u (undo) → j → r (reject with reason) → verify → ADM-56 Sperren asks four-eyes → analyst read-only', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [first, second] = await members('a5bizfirst', 'a5bizsecond');
    await named(first, 'Jana A5', 'Hamburg');
    await named(second, 'Lars A5', 'Hamburg');
    const prefix = `A5 Werkstatt ${first.username.slice(-4)}`;
    const one = await apply(first, `${prefix} Nord`);
    // The second application is a moment younger, so the queue (oldest first) shows the first on top.
    await page.waitForTimeout(1100);
    const two = await apply(second, `${prefix} Süd`);
    expect(one.status).toBe('applied');
    expect(two.status).toBe('applied');

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'moderator');
    await realClock(page);
    await confirmPasswordDirectly(context);

    // 1. ADM-55 Anträge, oldest first; the pane shows the Impressum check.
    await openQueue(page, prefix);
    const rows = id(page, 'ADM-55.table.row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(one.name);
    await rows.first().getByTestId('ADM-55.open').click();
    await expect(id(page, 'ADM-55.pane.title')).toHaveText(one.name);
    await expect(id(page, 'ADM-55.detail.impressum')).toContainText('HRB 123456');
    await expect(id(page, 'ADM-55.detail.impressum')).toContainText('Jana Petersen');

    // 2. `a` verifies, the queue moves on, `u` takes it back within 5 s.
    await page.locator('body').press('a');
    await expect(toast(page, admin('businesses', 'flash.verified'))).toBeVisible();
    await expect(id(page, 'ADM-55.undo')).toContainText(admin('businesses', 'undo.verified', { name: one.name }));
    await expect(id(page, 'ADM-55.pane.title')).toHaveText(two.name);
    expect((await mine(first)).status).toBe('verified');
    await page.locator('body').press('u');
    await expect(toast(page, admin('businesses', 'flash.reopened'))).toBeVisible();
    await expect(id(page, 'ADM-55.pane.title')).toHaveText(one.name);
    expect((await mine(first)).status).toBe('applied');

    // 3. `j` to the second, `r` rejects it with the reason its owner reads.
    await page.locator('body').press('j');
    await expect(id(page, 'ADM-55.pane.title')).toHaveText(two.name);
    const reason = 'Die Registernummer passt nicht zur Firma, bitte prüfe sie.';
    await page.locator('body').press('r');
    await expect(id(page, 'ADM-55.reject-dialog')).toBeVisible();
    await id(page, 'ADM-55.reject-dialog.reason').fill(reason);
    await id(page, 'ADM-55.reject-dialog.confirm').click();
    await expect(toast(page, admin('businesses', 'flash.rejected'))).toBeVisible();
    const rejected = await mine(second);
    expect(rejected.status).toBe('rejected');
    expect(rejected.status_reason).toBe(reason);

    // 4. The first again, from a fresh queue: `a`.
    await page.keyboard.press('Escape');
    await openQueue(page, prefix);
    await expect(id(page, 'ADM-55.table.row')).toHaveCount(1);
    await id(page, 'ADM-55.open').first().click();
    await expect(id(page, 'ADM-55.pane.title')).toHaveText(one.name);
    await page.locator('body').press('a');
    await expect(toast(page, admin('businesses', 'flash.verified'))).toBeVisible();
    expect((await mine(first)).status).toBe('verified');

    // 5. ADM-56: Sperren is four-eyes — a request, not a suspension.
    await page.goto(`/admin/businesses/${one.id}`);
    await expect(id(page, 'ADM-56.status')).toHaveText(admin('businesses', 'status.verified'));
    await id(page, 'ADM-56.suspend').click();
    await expect(id(page, 'ADM-56.suspend-dialog.four-eyes')).toBeVisible();
    await id(page, 'ADM-56.suspend-dialog.reason').fill('Das Impressum gehört nach Hinweisen zu einem anderen Betrieb.');
    await id(page, 'ADM-56.suspend-dialog.confirm').click();
    await expect(id(page, 'shell.approval')).toBeVisible();
    await expect(id(page, 'ADM-56.status')).toHaveText(admin('businesses', 'status.verified'));
    expect((await mine(first)).status).toBe('verified');

    // 6. The analyst: read-only, a direct decision refused.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await openQueue(analystPage, prefix);
      await expect(id(analystPage, 'ADM-55.view-only')).toBeVisible();
      const refused = await analyst.request.post(`/admin/businesses/${one.id}/reopen`, {
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst) },
        data: { version: 'x' },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await analyst.close();
    }
  });
});
