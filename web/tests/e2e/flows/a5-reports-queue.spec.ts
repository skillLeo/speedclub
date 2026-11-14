// A5 Meldungen on the shared SplitQueue (09 §10.2, §14.5 A5; ADM-20/21, 06 §3 Moderation DSA), Chromium at 1280 like the other admin
// flows. A test member reports two other test members' profiles through the member API (POST reports, as SAFE does). The moderator works
// ADM-20 by keyboard: opens the first case in the pane, `a` opens the ADM-21 composer with "Inhalt entfernen" preselected (closed again),
// `r` opens it with "Keine Maßnahme": the reason is required before anything is sent, then the decision goes out and the queue moves on
// to the second case (auto-advance). There "Übernehmen" assigns it and `u` takes that back within the 5 s; a DSA decision itself has no
// undo (it reaches the member and the reporter at once). The analyst sees the pane read-only and a direct POST answers 403. The accounts,
// their cases and decisions are removed after (delete-accounts).
import type { Page } from '@playwright/test';
import { admin, confirmPasswordDirectly, DESKTOP, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { deleteTestAccounts, testCases } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named, type Member } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

async function report(reporter: Member, target: Member): Promise<void> {
  expectStatus(await reporter.api.post('reports', { target_type: 'member', target_id: target.username, reason: 'spam' }), 201, `POST reports about ${target.username}`);
}

async function caseOf(member: Member): Promise<{ id: string; status: string }> {
  const found = (await testCases(member.email)).cases.filter((c: { target_type: string }) => c.target_type === 'member');
  expect(found, `one member case about ${member.username}`).toHaveLength(1);
  return found[0] as { id: string; status: string };
}

async function openQueue(page: Page, prefix: string): Promise<void> {
  await page.goto(`/admin/moderation/reports?${new URLSearchParams({ 'filter[q]': prefix }).toString()}`);
  await expect(id(page, 'ADM-20.table')).toBeVisible();
}

test.describe('A5 Meldungen', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');
  let made: Member[] = [];
  test.afterAll(async () => {
    for (const member of made) await deleteTestAccounts(member.email);
  });

  test('pane → a (composer, remove) → r (no action, reason required) → auto-advance → Übernehmen → u (undo) → analyst read-only', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [reporter, first, second] = await members('a5repreporter', 'a5repfirst', 'a5repsecond');
    made = [reporter, first, second];
    await named(first, 'Timo A5', 'Bremen');
    await named(second, 'Nele A5', 'Bremen');
    await report(reporter, first);
    // The second case is a moment younger; with the same priority the queue shows the older one first.
    await page.waitForTimeout(1100);
    await report(reporter, second);
    const one = await caseOf(first);
    const two = await caseOf(second);
    const prefix = first.username.slice(0, -2);

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'moderator');
    await realClock(page);
    await confirmPasswordDirectly(context);

    // 1. ADM-20 Neu, the first case in the pane: target, status, the decisions and its report.
    await openQueue(page, prefix);
    await expect(id(page, 'ADM-20.table.row')).toHaveCount(2);
    await id(page, 'ADM-20.open').first().click();
    await expect(id(page, 'ADM-20.pane')).toBeVisible();
    const firstTitle = (await id(page, 'ADM-20.pane.title').textContent()) ?? '';
    const firstIsOne = firstTitle.includes(first.username);
    const [decided, other] = firstIsOne ? [one, two] : [two, one];
    await expect(id(page, 'ADM-20.pane.reports')).toContainText(admin('moderation', 'reasons.spam'));
    await expect(id(page, 'ADM-20.decide')).toBeVisible();
    // DQ-1193: the case open in the pane is marked in the list, and every open case shows its SLA timer ("Wartet").
    await expect(page.locator('[data-testid="ADM-20.table.row"][aria-current="true"]')).toHaveCount(1);
    await expect(id(page, 'ADM-20.waiting')).toHaveCount(2);
    // DQ-1199: the button opens the composer without a preselected sanction, and "Entscheidung senden" waits for a choice.
    await id(page, 'ADM-20.decide').click();
    await expect(id(page, 'ADM-20.composer')).toBeVisible();
    await expect(id(page, 'ADM-20.composer').getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(id(page, 'ADM-20.composer.submit')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(id(page, 'ADM-20.composer')).toBeHidden();

    // 2. `a`: the composer with "Inhalt entfernen" preselected; nothing is sent by opening it.
    await page.locator('body').press('a');
    const composer = id(page, 'ADM-20.composer');
    await expect(composer).toBeVisible();
    await expect(composer.getByRole('radio', { name: new RegExp(`^${admin('moderation', 'composer.actions.remove_content')}`) })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(composer).toBeHidden();

    // 3. `r`: "Keine Maßnahme"; without a reason nothing goes out, with one the decision is sent and the queue moves on.
    await page.locator('body').press('r');
    await expect(composer).toBeVisible();
    await expect(composer.getByRole('radio', { name: new RegExp(`^${admin('moderation', 'composer.actions.no_action')}`) })).toBeChecked();
    // DQ-1199: "Entscheidung senden" stays off until the reason is given; nothing is sent.
    await expect(id(page, 'ADM-20.composer.submit')).toBeDisabled();
    await expect(composer).toBeVisible();
    expect((await caseOf(firstIsOne ? first : second)).status).not.toBe('decided');
    await id(page, 'ADM-20.composer.reason').fill('Profil geprüft, kein Spam erkennbar.');
    await id(page, 'ADM-20.composer.submit').click();
    await expect(toast(page, admin('moderation', 'flash.decided'))).toBeVisible();
    await expect(composer).toBeHidden();
    expect((await caseOf(firstIsOne ? first : second)).status).toBe('decided');
    await expect(page).toHaveURL(new RegExp(`case=${other.id}`));
    await expect(id(page, 'ADM-20.pane.title')).toContainText(firstIsOne ? second.username : first.username);
    expect(decided.id).not.toBe(other.id);

    // 4. Übernehmen, then `u` within the 5 s: back to unassigned and Neu.
    await id(page, 'ADM-20.pane.take').click();
    await expect(toast(page, admin('moderation', 'flash.taken'))).toBeVisible();
    await expect(id(page, 'ADM-20.undo')).toBeVisible();
    await page.locator('body').press('u');
    await expect(toast(page, admin('moderation', 'flash.released'))).toBeVisible();
    await expect(id(page, 'ADM-20.pane.status')).toHaveText(admin('moderation', 'status.new'));
    expect((await caseOf(firstIsOne ? second : first)).status).toBe('new');

    // 5. The analyst: the pane read-only; a direct decision and a direct undo are refused.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await analystPage.goto(`/admin/moderation/reports?case=${other.id}`);
      await expect(id(analystPage, 'ADM-20.pane.view-only')).toBeVisible();
      await expect(id(analystPage, 'ADM-20.decide')).toHaveCount(0);
      const headers = { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst) };
      expect((await analyst.request.post(`/admin/moderation/cases/${other.id}/decide`, { headers, data: { action: 'no_action', reason: 'Direkter Versuch ohne Recht.' } })).status()).toBe(403);
      expect((await analyst.request.post(`/admin/moderation/cases/${other.id}/release`, { headers })).status()).toBe(403);
    } finally {
      await analyst.close();
    }
  });
});
