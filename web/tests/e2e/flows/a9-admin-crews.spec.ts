// A9 Crews (R4-2.3, ADM-80/81, contract-crews.md C6), Chromium at 1280 like the other admin flows. A test member founds a crew through
// the member API (POST crews, as CREW-00 sends it) and a second one joins it. The moderator finds it on ADM-80 by search, opens ADM-81
// (members with their roles), hides it with a statement of reasons (the crew is gone for a non-member: 404 crew_unavailable, its member
// still sees it), shows it again with the facts the founder reads, hides it once more, deletes it (gone for its members too) and
// restores it (hidden again). The analyst (moderation.view only) hears 403 on the list and on a direct POST. The crews flag is on in
// local/staging (FeatureFlagSeeder).
import type { Page } from '@playwright/test';
import { admin, confirmPasswordDirectly, DESKTOP, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named, type Member } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type CrewBody = { id: string; slug: string; name: string; viewer: { state: string } | null };

async function found(member: Member, name: string): Promise<CrewBody> {
  return expectStatus(await member.api.post('crews', { name, description: 'Wir treffen uns jeden zweiten Samstag am Hafen.', join_mode: 'open' }), 201, 'POST crews').data as CrewBody;
}

async function crewStatus(member: Member, slug: string): Promise<number> {
  return (await member.api.get(`crews/${slug}`)).status;
}

async function hide(page: Page): Promise<void> {
  await id(page, 'ADM-81.action.hide').click();
  await expect(id(page, 'ADM-81.hide')).toBeVisible();
  await id(page, 'ADM-81.hide.statement.facts').fill('Die Crew wirbt in Name und Beschreibung für einen Teileverkauf.');
  await id(page, 'ADM-81.hide.statement.ground').fill('Keine Werbung und kein Spam');
  await id(page, 'ADM-81.hide.confirm').click();
  await expect(toast(page, admin('crews', 'flash.hidden'))).toBeVisible();
  await expect(id(page, 'ADM-81.status')).toHaveText(admin('crews', 'state.hidden'));
}

test.describe('A9 Crews', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('ADM-80 search → ADM-81 → hide → unhide → hide → delete → restore; analyst 403', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [founder, member, outsider] = await members('a9crewfounder', 'a9crewmember', 'a9crewoutsider');
    await named(founder, 'Jana A9', 'Hamburg');
    const name = `A9 Hafen Crew ${founder.username.slice(-4)}`;
    const crew = await found(founder, name);
    expectStatus(await member.api.post(`crews/${crew.slug}/join`), 200, 'POST crews/{slug}/join');

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'moderator');
    await realClock(page);
    await confirmPasswordDirectly(context);

    // 1. ADM-80: found by search, the row opens ADM-81.
    await page.goto(`/admin/crews?${new URLSearchParams({ 'filter[q]': name }).toString()}`);
    await expect(id(page, 'ADM-80.table')).toBeVisible();
    await expect(id(page, 'ADM-80.open')).toHaveCount(1);
    await expect(id(page, 'ADM-80.state')).toHaveText(admin('crews', 'state.active'));
    await id(page, 'ADM-80.open').click();
    await expect(page).toHaveURL(new RegExp(`/admin/crews/${crew.id}`));
    await expect(id(page, 'ADM-81.status')).toHaveText(admin('crews', 'state.active'));
    await expect(id(page, 'ADM-81.description')).toContainText('Hafen');

    // 2. Mitglieder: the founder first, then the member.
    await page.getByRole('tab', { name: new RegExp(admin('crews', 'record.tabs.members')) }).click();
    await expect(id(page, 'ADM-81.member')).toHaveCount(2);
    await expect(id(page, 'ADM-81.member').first()).toContainText(`@${founder.username}`);
    await expect(id(page, 'ADM-81.member').first()).toContainText(admin('crews', 'roles.founder'));

    // 3. Ausblenden: a DSA decision; gone for an outsider, still there for its member.
    await hide(page);
    expect(await crewStatus(outsider, crew.slug)).toBe(404);
    expect(await crewStatus(member, crew.slug)).toBe(200);

    // 4. Einblenden with the facts the founder reads.
    await id(page, 'ADM-81.action.unhide').click();
    await id(page, 'ADM-81.unhide.facts').fill('Die Werbung wurde aus der Beschreibung entfernt.');
    await id(page, 'ADM-81.unhide.confirm').click();
    await expect(toast(page, admin('crews', 'flash.unhidden'))).toBeVisible();
    await expect(id(page, 'ADM-81.status')).toHaveText(admin('crews', 'state.active'));
    expect(await crewStatus(outsider, crew.slug)).toBe(200);

    // 5. Löschen only after a hide; then gone for its member too. Wiederherstellen brings it back hidden.
    await expect(id(page, 'ADM-81.action.remove')).toHaveCount(0);
    await hide(page);
    await id(page, 'ADM-81.action.remove').click();
    await id(page, 'ADM-81.remove.confirm').click();
    await expect(toast(page, admin('crews', 'flash.removed'))).toBeVisible();
    await expect(id(page, 'ADM-81.status')).toHaveText(admin('crews', 'state.removed'));
    expect(await crewStatus(member, crew.slug)).toBe(404);

    await id(page, 'ADM-81.action.restore').click();
    await id(page, 'ADM-81.restore.confirm').click();
    await expect(toast(page, admin('crews', 'flash.restored'))).toBeVisible();
    await expect(id(page, 'ADM-81.status')).toHaveText(admin('crews', 'state.hidden'));
    expect(await crewStatus(member, crew.slug)).toBe(200);

    // 6. The activity column lists the staff steps.
    await expect(page.getByTestId('ADM-81').getByText(admin('audit', 'actions.crew.restored')).first()).toBeVisible();
    await expect(page.getByTestId('ADM-81').getByText(admin('audit', 'actions.crew.removed')).first()).toBeVisible();

    // 7. The analyst holds moderation.view only: 403 on the list and on a direct POST.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [{ status: 403, url: /\/admin\/crews(\/[^/]+\/unhide)?$/ }] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      const list = await analystPage.goto('/admin/crews');
      expect(list?.status()).toBe(403);
      const refused = await analyst.request.post(`/admin/crews/${crew.id}/unhide`, {
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst) },
        data: { facts: 'Direkter Versuch ohne Recht.', reason: 'Direkter Versuch ohne Recht.' },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await analyst.close();
    }
  });
});
