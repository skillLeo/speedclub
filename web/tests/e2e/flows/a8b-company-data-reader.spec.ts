// A8b company data, the reader's side (ADM-52), on Chromium and WebKit: the client's report of 2026-11-23 ("in the admin panel I
// can't save the company data"). Staging: the account the client signs in with is an Admin, and ADM-52 is Owner only (ADR-239); the
// page showed disabled fields that look like empty ones, one grey line, no Save, and no word on who can change the data.
//
// The Admin opens ADM-52: a notice says that only an Owner can change the company data, how to get there, and names the Owners to ask;
// there is no Save button and the fields are read-only. The Owner's save and the Impressum it fills are flows/a8-org-settings.spec.ts.
//
// The Admin is the global setup's shared `staff-admin` session (read only here), so this spec adds no staff sign-in of its own.
import { admin, DESKTOP, realClock } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { id, open } from '../support/flow';
import { staffRun, staffSession } from '../support/staff.mjs';

test.describe('A8b company data, read by an Admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('ADM-52: an Admin is told that only an Owner saves the company data, and whom to ask', async ({ page, context }) => {
    const ownerName = (await staffRun()).accounts.owner?.name ?? '';
    expect(ownerName, 'the owner fixture has a name').not.toBe('');
    await context.addCookies(await staffSession('staff-admin'));
    await open(page, '/admin/settings', { now: await realClock(page) });
    await expect(id(page, 'ADM-52.group.company')).toBeVisible();

    const notice = id(page, 'ADM-52.view-only');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('heading', { name: admin('settings', 'owner_only_title') })).toBeVisible();
    await expect(notice).toContainText(admin('settings', 'owner_only'));
    await expect(id(page, 'ADM-52.owners')).toContainText(ownerName);
    await expect(id(page, 'ADM-52.save')).toHaveCount(0);
    await expect(id(page, 'ADM-52.field.company_name')).toBeDisabled();
  });
});
