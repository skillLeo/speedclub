// A1 Restrict user (02_PRODUCT_SPEC §4 A1, m3.2-contract §1–§2 and §5, 06_ADMIN_SPEC §3 Members, ADR-214/215/224), on Chromium and
// WebKit. Staff: admins (not Owners: ADR-237's maximum of 3) and a moderator of their own per browser project (support/backend.php STAFF_FIXTURES `a1-*`), each signed in
// here over HTTP in a session of its own, because every one of them confirms its password (ADR-215) and the shared sessions must stay as
// they are. The member is a test member of its own (createGarageMember, removed with what the decisions made about it), never a demo
// member: ADM-09 → filter → ADM-10 → Einschränken (messaging, 7 days, template + edited facts, reason) → the password dialog → the audit
// row on the Audit tab, the statement-of-reasons mail in the local mailbox, the restriction in the member's thread and on SAFE-01; then
// Aufheben → the reversal on SAFE-01 and the composer back. The four-eyes half: the moderator asks for a suspension of the same member,
// cannot approve it, and an admin approves it on ADM-43 in a second browser context. The admin pages run on the real clock: the end of a
// measure is "now + 7 days" on the device, and the server refuses an end in its past.
import type { BrowserContext } from '@playwright/test';
import { admin, choose, confirmPassword, DESKTOP, lead, pageProps, realClock, serverCopy, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { apiLogin } from '../support/auth.mjs';
import { deleteTestAccounts, runTestJobs, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, de, flowShot, follow, id, members, named, open, startConversation, type Member } from '../support/flow';
import { expectStatus, GARAGE_PASSWORD } from '../support/garage.mjs';

/**
 * The statement-of-reasons mail of a decision about `member` with `text` in it: the queue worker does not run locally, so its job runs
 * here (support/backend.php run-test-jobs).
 */
async function decisionMail(member: Member, subject: string, text: string) {
  const { ran } = await runTestJobs(member.email);
  expect(ran, 'the decision queued its statement-of-reasons mail (SendDecisionMail)').toContain('SendDecisionMail');
  return waitForMail(member.email, (mail) => mail.subject === subject && mail.text.includes(text));
}

/** The member's own decisions, newest first, as SET-16 lists them. */
async function decisions(member: Member): Promise<{ id: string; action: string }[]> {
  return expectStatus(await member.api.get('me/decisions'), 200, `GET me/decisions of ${member.username}`).data;
}

/** The approval requests of a staff session, from the page data ADM-43 renders with. */
async function approvalsOf(context: BrowserContext, tab: 'mine' | 'for_me'): Promise<{ id: string; action: string; subject_label: string | null; status: string; can_decide: boolean }[]> {
  return (await pageProps<{ requests: { id: string; action: string; subject_label: string | null; status: string; can_decide: boolean }[] }>(context, `/admin/team/approvals?tab=${tab}`)).requests;
}

test.describe.configure({ mode: 'serial' });

test.describe('A1 restrict member', () => {
  let target: Member;
  let conversationId: string;
  let prefix: string;

  test.beforeAll(async ({}, testInfo) => {
    // Own members per browser project, so the cleanup below removes only this project's.
    const tag = `a1${testInfo.project.name}`;
    prefix = `garage.${tag}`;
    const [member, other] = await members(tag, `${tag}b`);
    target = member;
    await named(target, 'Kai Neumann', 'Dortmund');
    await named(other, 'Lea Hartmann');
    // A chat the member can write in, so the restriction shows where the composer was.
    await follow(other, target.username);
    const started = await startConversation(target, other.username, 'Servus, hast du die Felgen noch?');
    expect(started.conversation.request_pending).toBe(false);
    conversationId = started.conversation.id;
  });

  test.afterAll(async () => {
    // The teardown would remove them too; this run's own go at once, with the cases, decisions and approvals about them.
    if (prefix) await deleteTestAccounts(prefix);
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('ADM-09 → ADM-10 → Einschränken behind the password dialog: audit row, mail and SAFE-01; Aufheben → "Entscheidung aufgehoben"', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(240_000);
    const owner = await staffContext(context, `a1-admin-${browserName}`);
    const now = await realClock(page);

    // ADM-09: search the member, open the record.
    await open(page, '/admin/members', { now });
    await expect(id(page, 'ADM-09.table')).toBeVisible();
    await id(page, 'ADM-09.filter.q').fill(target.username);
    await id(page, 'ADM-09.filter.apply').click();
    const found = id(page, 'ADM-09.open');
    await expect(found).toHaveCount(1);
    await expect(found).toContainText(`@${target.username}`);
    await found.click();
    await expect(id(page, 'ADM-10')).toBeVisible();
    await expect(id(page, 'ADM-10.status')).toHaveText(admin('members', 'status.active'));

    // Einschränken: messaging, 7 days, the template, its facts edited, a reason.
    await id(page, 'ADM-10.action.restrict').click();
    const dialog = id(page, 'ADM-10.restrict');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: new RegExp(`^${admin('decisions', 'measures.messaging')}`) })).toBeChecked();
    await choose(page, dialog, admin('decisions', 'duration'), admin('decisions', 'durations.7'));
    await choose(page, dialog, admin('decisions', 'template'), admin('decisions', 'templates.spam.label'));
    const facts = id(page, 'ADM-10.restrict.statement.facts');
    await expect(facts).toHaveValue(admin('decisions', 'templates.spam.facts_member'));
    await expect(id(page, 'ADM-10.restrict.statement.ground')).toHaveValue(admin('decisions', 'templates.spam.ground'));
    const editedFacts = `${admin('decisions', 'templates.spam.facts_member')} Zuletzt am 7. November an elf Mitglieder mit demselben Shop-Link.`;
    await facts.fill(editedFacts);
    const reason = `A1 ${browserName}: wiederholte Werbenachrichten, drei Meldungen per Support-Mail`;
    await id(page, 'ADM-10.restrict.reason').fill(reason);
    await flowShot(page, testInfo, 'ADM-10-restrictDialog', { phase: 3 });
    await id(page, 'ADM-10.restrict.confirm').click();
    await confirmPassword(page);
    await expect(toast(page, admin('members', 'flash.restricted'))).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(id(page, 'ADM-10.status')).toHaveText(admin('members', 'status.restricted'));
    await expect(id(page, 'ADM-10.restrictions')).toContainText(admin('decisions', 'measures.messaging'));
    await expect(id(page, 'ADM-10.lift.messaging')).toBeVisible();

    // Audit tab: the decision with the staff member and the reason.
    // A tab that does not fit the strip sits in the last "Mehr" menu (DQ-525).
    const auditTab = page.getByRole('tab', { name: admin('members', 'tabs.audit'), exact: true });
    if ((await auditTab.count()) > 0) await auditTab.click();
    else {
      await page.getByTestId('tabs.more').click();
      await page.getByRole('menuitem', { name: admin('members', 'tabs.audit'), exact: true }).click();
    }
    await expect(id(page, 'ADM-10.audit')).toBeVisible();
    const auditRow = id(page, 'ADM-10.audit').locator('tbody tr').filter({ hasText: reason });
    await expect(auditRow).toHaveCount(1);
    await expect(auditRow).toContainText(owner.name);

    // The mail: an own-initiative decision with the facts as written and the full redress (Art. 17 DSA).
    const mail = await decisionMail(target, serverCopy('mail.decision.subject_own'), editedFacts);
    expect(mail.text).toContain(admin('decisions', 'templates.spam.ground'));
    for (const line of ['mail.decision.detection_own', 'mail.decision.decision_no', 'mail.decision.redress.internal_complaint', 'mail.decision.redress.out_of_court', 'mail.decision.redress.court']) {
      expect(mail.text, line).toContain(lead(serverCopy(line)));
    }

    // The member: the composer gives way to the restriction note with its decision; SAFE-01 has the statement and the redress.
    const member = await browserOf(browser, target, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(member.page, `/app/messages/${conversationId}`);
      await expect(id(member.page, 'MSG-02.closed')).toContainText(de('messages', 'thread.restricted'));
      await expect(id(member.page, 'MSG-02.closed.decision')).toBeVisible();
      await expect(id(member.page, 'MSG-02.composer')).toHaveCount(0);
      await flowShot(member.page, testInfo, 'MSG-02-restrictedByStaff', { phase: 3 });

      // The note's link opens the decision behind the restriction (me.restrictions.messaging.decision_id).
      const restriction = (await decisions(target)).find((d) => d.action === 'restrict');
      if (!restriction) throw new Error('The member has no restrict decision');
      await id(member.page, 'MSG-02.closed.decision').click();
      await expect.poll(() => new URL(member.page.url()).pathname).toBe(`/app/decision/${restriction.id}`);
      await expect(id(member.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleAffected.restrict'));
      await expect(id(member.page, 'SAFE-01.restricted')).toBeVisible();
      await expect(id(member.page, 'SAFE-01.facts')).toHaveText(editedFacts);
      await expect(id(member.page, 'SAFE-01.automatedText')).toContainText(de('safety', 'decision.detectionStaff'));
      await expect(id(member.page, 'SAFE-01.section.redress')).toBeVisible();
      await expect(id(member.page, 'SAFE-01.appeal.open')).toBeVisible();
      await expect(id(member.page, 'SAFE-01.appealButton')).toBeEnabled();
      await expect(id(member.page, 'SAFE-01.disputeLink')).toBeVisible();
      await expect(id(member.page, 'SAFE-01.court')).toBeVisible();
      await flowShot(member.page, testInfo, 'SAFE-01-staffRestriction', { phase: 3 });

      // Aufheben (a reverse decision): no password, it gives the member back what was taken.
      await page.getByRole('tab', { name: admin('members', 'tabs.overview'), exact: true }).click();
      await id(page, 'ADM-10.lift.messaging').click();
      await expect(id(page, 'ADM-10.lift')).toBeVisible();
      const liftFacts = 'Der Shop-Link stammte aus einer Club-Aktion, die wir selbst angekündigt hatten. Die Einschränkung war nicht nötig.';
      await id(page, 'ADM-10.lift.facts').fill(liftFacts);
      await id(page, 'ADM-10.lift.reason').fill(`A1 ${browserName}: Rückmeldung des Mitglieds geprüft, Aktion war freigegeben`);
      await id(page, 'ADM-10.lift.confirm').click();
      await expect(toast(page, admin('members', 'flash.lifted'))).toBeVisible();
      await expect(id(page, 'ADM-10.status')).toHaveText(admin('members', 'status.active'));
      await expect(id(page, 'ADM-10.lift.messaging')).toHaveCount(0);

      const reversed = await decisionMail(target, serverCopy('mail.reversed.subject'), liftFacts);
      expect(reversed.text).toContain(serverCopy('mail.reversed.lifted.restrict_messaging'));

      const reversal = (await decisions(target)).find((d) => d.action === 'reverse');
      if (!reversal) throw new Error('The member has no reverse decision');
      await open(member.page, `/app/decision/${reversal.id}`);
      await expect(id(member.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleAffected.reverse'));
      await expect(id(member.page, 'SAFE-01.outcome')).toHaveText(de('safety', 'decision.outcome.reverseAccount'));
      await expect(id(member.page, 'SAFE-01.reverseNote')).toBeVisible();
      await expect(id(member.page, 'SAFE-01.original')).toBeVisible();
      await expect(id(member.page, 'SAFE-01.section.redress')).toHaveCount(0);
      await flowShot(member.page, testInfo, 'SAFE-01-reversedByStaff', { phase: 3 });

      await open(member.page, `/app/messages/${conversationId}`);
      await expect(id(member.page, 'MSG-02.composer')).toBeVisible();
      await expect(id(member.page, 'MSG-02.closed')).toHaveCount(0);
    } finally {
      await member.context.close();
    }
  });

  test('four-eyes: a moderator asks for a suspension and cannot approve it; an admin approves it on ADM-43; the member is suspended', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(240_000);
    const moderator = await staffContext(context, `a1-moderator-${browserName}`);
    const now = await realClock(page);

    // ADM-10 as the moderator: Sperre is four-eyes, at most 30 days for a moderator (no "Ohne Ende").
    await open(page, `/admin/members/${target.username}`, { now });
    await expect(id(page, 'ADM-10')).toBeVisible();
    await id(page, 'ADM-10.action.restrict').click();
    const dialog = id(page, 'ADM-10.restrict');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: new RegExp(`^${admin('decisions', 'measures.suspension')}`) }).check();
    await expect(id(page, 'ADM-10.restrict.four-eyes')).toBeVisible();
    const duration = dialog.getByRole('combobox', { name: new RegExp(`^${admin('decisions', 'duration')}`) });
    await duration.click();
    await expect(page.getByRole('option', { name: admin('decisions', 'durations.none'), exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: admin('decisions', 'durations.7'), exact: true }).click();
    await choose(page, dialog, admin('decisions', 'template'), admin('decisions', 'templates.harassment.label'));
    const facts = `${admin('decisions', 'templates.harassment.facts_member')} Betroffen waren zwei Mitglieder aus dem Club Dortmund.`;
    await id(page, 'ADM-10.restrict.statement.facts').fill(facts);
    const reason = `A1 ${browserName}: Beleidigungen nach der Aufhebung, Sperre für eine Woche`;
    await id(page, 'ADM-10.restrict.reason').fill(reason);
    await expect(id(page, 'ADM-10.restrict.confirm')).toHaveText(admin('decisions', 'submit_suspend'));
    await id(page, 'ADM-10.restrict.confirm').click();
    await confirmPassword(page);
    await expect(id(page, 'shell.approval')).toBeVisible();
    await flowShot(page, testInfo, 'ADM-10-suspensionRequested', { phase: 3 });
    // Asked for, not done.
    await expect(id(page, 'ADM-10.status')).toHaveText(admin('members', 'status.active'));
    await expect(id(page, 'ADM-10.pending')).toBeVisible();

    // The requester sees it under Von mir, without Freigeben, and the server refuses a direct approval.
    const mine = (await approvalsOf(context, 'mine')).find((r) => r.action === 'moderation.suspend' && r.subject_label?.includes(target.username));
    if (!mine) throw new Error('The suspension request is not on the moderator\'s ADM-43');
    expect(mine).toMatchObject({ status: 'pending', can_decide: false });
    await open(page, '/admin/team/approvals?tab=mine', { now });
    const own = page.locator('[data-testid="ADM-43.request"][data-action="moderation.suspend"]:visible').filter({ hasText: `@${target.username}` });
    await expect(own).toHaveCount(1);
    await expect(own.locator('[data-testid="ADM-43.approve"]')).toHaveCount(0);
    await expect(own.locator('[data-testid="ADM-43.cancel"]')).toBeVisible();
    const direct = await context.request.post(`/admin/team/approvals/${mine.id}/approve`, {
      headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(context) },
      data: { comment: '' },
      maxRedirects: 0,
    });
    expect(direct.status(), 'a moderator cannot approve their own suspension request').toBe(403);
    expect((await approvalsOf(context, 'mine')).find((r) => r.id === mine.id)?.status).toBe('pending');

    // A second browser: an admin (approvals.decide + members.suspend, ADR-214) approves it on ADM-43 Für mich, behind the password dialog.
    const second = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(second.context, `a1-approver-${browserName}`);
      const approverNow = await realClock(second.page);
      await open(second.page, '/admin/team/approvals', { now: approverNow });
      const card = second.page.locator('[data-testid="ADM-43.request"][data-action="moderation.suspend"]:visible').filter({ hasText: `@${target.username}` });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(moderator.name);
      await expect(card).toContainText(reason);
      await card.locator('[data-testid="ADM-43.approve"]').click();
      await expect(id(second.page, 'ADM-43.decide')).toBeVisible();
      await id(second.page, 'ADM-43.comment').fill('Geprüft, Belege im Support-Ticket.');
      await id(second.page, 'ADM-43.decide.confirm').click();
      await confirmPassword(second.page);
      await expect(id(second.page, 'ADM-43.decide')).toBeHidden();

      await open(second.page, `/admin/members/${target.username}`, { now: approverNow });
      await expect(id(second.page, 'ADM-10.status')).toHaveText(admin('members', 'status.suspended'));
      await expect(id(second.page, 'ADM-10.restrictions')).toContainText(admin('decisions', 'measures.suspension'));
      await flowShot(second.page, testInfo, 'ADM-10-suspended', { phase: 3 });
    } finally {
      await second.context.close();
    }

    // Executed under the requester's name; the member can no longer sign in, and the mail says how to appeal while suspended.
    expect((await approvalsOf(context, 'mine')).find((r) => r.id === mine.id)?.status).toBe('executed');
    const suspension = await decisionMail(target, serverCopy('mail.decision.subject_own'), facts);
    expect(suspension.text).toContain(lead(serverCopy('mail.decision.note_suspended')));
    await expect(apiLogin(target.email, GARAGE_PASSWORD)).rejects.toThrow(/HTTP 403/);
  });
});
