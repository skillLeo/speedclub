// A4 Role assignment (02_PRODUCT_SPEC §4 A4, m3.6-contract §1 and §3, 06_ADMIN_SPEC §2, ADR-214, ADR-215, ADR-237), on Chromium and
// WebKit. Staff of its own per browser project (support/backend.php `a4-*`), each signed in here over HTTP in a session of its own: an
// admin who asks, a second admin who approves, and a support member whose roles change; plus the one Owner fixture `a4-owner` (shared by
// both projects) who asks to grant Owner, and the registry's Owner `owner` in a session of its own as the Owner approver.
//
// ADM-39 → the subject → ADM-40 Rollen ändern → Admin → the atom diff (neue Rechte, four-eyes reasons) → Freigabe anfragen behind the
// password dialog → the request is pending, the roles unchanged; the requester and the subject cannot approve it → the second admin
// approves it on ADM-43 in another browser context → the subject's next request (the same session) has the new permissions → audit rows
// (staff.roles_changed by the approver with the reason, approval.requested and approval.approved). Then the refusals:
// - granting Owner needs an Owner approver: an admin who could approve anything else cannot (can_decide false, a direct POST 403); an
//   Owner can, and the execution then fails on the Owner maximum (ADR-237: 3, with the seeded Owner, `owner` and `a4-owner`), so no
//   fourth Owner ever exists;
// - the subject cannot approve a request about themselves: once Admin, the subject holds every atom, so their 403 on the step back to
//   Support (four-eyes, SF-6) comes from that rule alone (Approvals::isAbout); the second admin approves it, and the subject's next
//   request has lost the permissions again.
// The fixtures go with the run (delete-staff), their requests with them; their audit events stay (append-only).
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { admin, confirmPassword, confirmPasswordDirectly, DESKTOP, pageProps, realClock, serverLang, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { browserOf, flowShot, id, open } from '../support/flow';
import { staffRun } from '../support/staff.mjs';

type Approval = { id: string; action: string; subject_label: string | null; status: string; can_decide: boolean; mine: boolean; reason: string; requested_by: string | null; decided_by: string | null; result: { error: string | null } };
type AuditRow = { action: string; reason: string | null; actor: { label: string | null }; target: { type: string; id: string } | null };
type StaffShow = { member: { roles: string[] }; pending: { id: string; action: string }[]; activity: { action: string; actor: string | null; reason: string | null }[] };

/** The approval requests a staff session sees on ADM-43 (`all` for Owners and Admins). */
async function approvals(context: BrowserContext, tab: 'mine' | 'for_me' | 'all'): Promise<Approval[]> {
  return (await pageProps<{ requests: Approval[] }>(context, `/admin/team/approvals?tab=${tab}`)).requests;
}

/** A direct approval the page would never send for this session, after a fresh password confirmation: answered by the rules alone. */
async function approveDirectly(context: BrowserContext, approvalId: string, confirm = true): Promise<number> {
  if (confirm) await confirmPasswordDirectly(context);
  const response = await context.request.post(`/admin/team/approvals/${approvalId}/approve`, {
    headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(context) },
    data: { comment: '' },
    maxRedirects: 0,
  });
  return response.status();
}

/** What a session's next request may do: ADM-42 needs roles.manage (Admin and Owner only). */
async function permissionsPage(context: BrowserContext): Promise<number> {
  return (await context.request.get('/admin/team/permissions', { headers: { Accept: 'text/html' }, maxRedirects: 0 })).status();
}

/**
 * ADR-215: the password dialog comes when the last confirmation of this session is older than 5 minutes, else the action runs at once
 * and `done` (what the page shows when it ran) appears.
 */
async function confirmPasswordIfAsked(page: Page, done: Locator): Promise<void> {
  const asked = id(page, 'shell.password');
  await expect(asked.or(done).first()).toBeVisible();
  if (await asked.isVisible()) await confirmPassword(page);
}
/** ADM-43's answer to a decision: the success or the error toast. */
const decided = (page: Page): Locator => page.locator('[data-testid="toast.success"]:visible, [data-testid="toast.error"]:visible');

/** ADM-40 of a staff member: Rollen ändern with the given role set ticked. */
async function chooseRoles(page: Page, staffId: number, roles: Record<string, boolean>): Promise<void> {
  await open(page, `/admin/team/${staffId}`, { now: new Date().toISOString() });
  await expect(id(page, 'ADM-40-page')).toBeVisible();
  await id(page, 'ADM-40.roles').click();
  const drawer = id(page, 'ADM-40.roles-drawer');
  await expect(drawer).toBeVisible();
  for (const [role, on] of Object.entries(roles)) {
    const box = drawer.getByRole('checkbox', { name: admin('team', `roles_names.${role}`), exact: true });
    if (on) await box.check();
    else await box.uncheck();
  }
}

/** The ADM-43 card of a role change about `name`, in a session's page. */
const card = (page: Page, name: string) => page.locator('[data-testid="ADM-43.request"][data-action="staff.role_elevation"]:visible').filter({ hasText: name });

async function approveOnAdm43(page: Page, name: string, requester: string, reason: string): Promise<void> {
  await open(page, '/admin/team/approvals', { now: new Date().toISOString() });
  const request = card(page, name);
  await expect(request).toHaveCount(1);
  await expect(request).toContainText(requester);
  await expect(request).toContainText(reason);
  await request.locator('[data-testid="ADM-43.approve"]').click();
  await expect(id(page, 'ADM-43.decide')).toBeVisible();
  await id(page, 'ADM-43.comment').fill('Geprüft mit der Teamleitung, Vertretung im Dezember.');
  await id(page, 'ADM-43.decide.confirm').click();
  await confirmPasswordIfAsked(page, decided(page));
  await expect(id(page, 'ADM-43.decide')).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test.describe('A4 role assignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('ADM-40: support → Admin with the atom diff, an approval request, a second admin approves on ADM-43; the role is active; audit rows', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(240_000);
    const run = await staffRun();
    const subject = run.accounts[`a4-subject-${browserName}`];
    if (!subject) throw new Error('No a4-subject fixture');
    const requester = await staffContext(context, `a4-admin-${browserName}`);
    const now = await realClock(page);

    // The subject, signed in before the change in a session of its own: its next request tells what it may do.
    const subjectTab = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    const approverTab = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(subjectTab.context, `a4-subject-${browserName}`);
      expect(await permissionsPage(subjectTab.context), 'support has no roles.manage before the change').toBe(403);

      // ADM-39: find the subject, open ADM-40.
      await open(page, '/admin/team', { now });
      await expect(id(page, 'ADM-39.table')).toBeVisible();
      await id(page, 'ADM-39.filter.q').fill(subject.email);
      await id(page, 'ADM-39.filter.apply').click();
      const found = page.locator('[data-testid="ADM-39.open"]:visible');
      await expect(found).toHaveCount(1);
      await expect(found).toContainText(subject.name);
      await found.click();
      await expect(id(page, 'ADM-40-page')).toBeVisible();
      await expect(id(page, 'ADM-40.role-list')).toContainText(admin('team', 'roles_names.support'));

      // Rollen ändern → Admin: the atoms it adds, none it removes, why it needs a second person.
      await id(page, 'ADM-40.roles').click();
      const drawer = id(page, 'ADM-40.roles-drawer');
      await expect(drawer).toBeVisible();
      await drawer.getByRole('checkbox', { name: admin('team', 'roles_names.admin'), exact: true }).check();
      const diff = id(page, 'ADM-40.roles-drawer.diff');
      for (const atom of ['approvals.decide', 'roles.manage', 'staff.manage', 'audit.export', 'members.delete']) {
        await expect(diff, atom).toContainText(`+ ${admin('team', `atoms.${atom}`)}`);
      }
      // The support atoms stay: nothing under Entfallende Rechte.
      await expect(diff.locator(':scope > div').nth(1)).toContainText(admin('team', 'roles_drawer.none_removed'));
      await expect(id(page, 'ADM-40.roles-drawer.four-eyes')).toBeVisible();
      await expect(drawer).toContainText(admin('team', 'roles_drawer.why.elevates'));
      await expect(id(page, 'ADM-40.roles-drawer.submit')).toHaveText(admin('team', 'roles_drawer.submit_four_eyes'));
      const reason = `A4 ${browserName}: übernimmt die Teamleitung Support während der Elternzeit`;
      await id(page, 'ADM-40.roles-drawer.reason').fill(reason);
      await flowShot(page, testInfo, 'ADM-40-rolesDiff', { phase: 3 });
      await id(page, 'ADM-40.roles-drawer.submit').click();
      await confirmPassword(page);
      await expect(id(page, 'shell.approval')).toBeVisible();
      await expect(drawer).toBeHidden();
      // Asked for, not done.
      await expect(id(page, 'ADM-40.pending')).toBeVisible();
      await expect(id(page, 'ADM-40.role-list')).not.toContainText(admin('team', 'roles_names.admin'));
      expect(await permissionsPage(subjectTab.context)).toBe(403);

      const mine = (await approvals(context, 'mine')).find((r) => r.action === 'staff.role_elevation' && r.subject_label === subject.name && r.status === 'pending');
      if (!mine) throw new Error('The role change is not on the requester\'s ADM-43');
      expect(mine.can_decide).toBe(false);

      // The requester cannot approve it; neither can the subject (support: no approvals.decide).
      await open(page, '/admin/team/approvals?tab=mine', { now: new Date().toISOString() });
      await expect(card(page, subject.name)).toHaveCount(1);
      await expect(card(page, subject.name).locator('[data-testid="ADM-43.approve"]')).toHaveCount(0);
      expect(await approveDirectly(context, mine.id), 'the requester cannot approve their own request').toBe(403);
      expect(await approveDirectly(subjectTab.context, mine.id, false), 'the subject cannot approve their own elevation').toBe(403);

      // A second admin approves it on ADM-43 Für mich, in another browser context.
      const approver = await staffContext(approverTab.context, `a4-approver-${browserName}`);
      await realClock(approverTab.page);
      await approveOnAdm43(approverTab.page, subject.name, requester.name, reason);
      await expect(toast(approverTab.page, admin('approvals', 'flash.approved'))).toBeVisible();

      // The role is active: the subject's next request in the same session may open the permission matrix.
      expect(await permissionsPage(subjectTab.context), 'the subject\'s next request has roles.manage').toBe(200);
      await open(subjectTab.page, '/admin/team/permissions', { now: new Date().toISOString() });
      await expect(id(subjectTab.page, 'ADM-42')).toBeVisible();

      await open(page, `/admin/team/${subject.id}`, { now: new Date().toISOString() });
      await expect(id(page, 'ADM-40.role-list')).toContainText(admin('team', 'roles_names.admin'));
      await expect(id(page, 'ADM-40.atoms')).toContainText(admin('team', 'show.all_atoms'));
      await expect(id(page, 'ADM-40.pending')).toHaveCount(0);
      await flowShot(page, testInfo, 'ADM-40-roleApproved', { phase: 3 });
      const show = await pageProps<StaffShow>(context, `/admin/team/${subject.id}`);
      expect([...show.member.roles].sort()).toEqual(['admin', 'support']);
      expect(show.activity.find((e) => e.action === 'staff.roles_changed' && e.reason === reason)?.actor).toBe(approver.name);

      // Audit: the change under the approver's name with the reason; the request and its approval.
      const changed = (await pageProps<{ rows: { data: AuditRow[] } }>(context, `/admin/audit?filter[action]=staff.roles_changed&filter[target_id]=${subject.id}`)).rows.data;
      expect(changed.find((r) => r.reason === reason)?.actor.label, 'staff.roles_changed by the approver').toBe(approver.name);
      const trail = (await pageProps<{ rows: { data: AuditRow[] } }>(context, `/admin/audit?filter[target_id]=${mine.id}`)).rows.data;
      expect(trail.find((r) => r.action === 'approval.requested')?.actor.label).toBe(requester.name);
      expect(trail.find((r) => r.action === 'approval.approved')?.actor.label).toBe(approver.name);
      const done = (await approvals(approverTab.context, 'all')).find((r) => r.id === mine.id);
      expect(done).toMatchObject({ status: 'executed', decided_by: approver.name });
    } finally {
      await subjectTab.context.close();
      await approverTab.context.close();
    }
  });

  test('refusals: granting Owner needs an Owner approver (and the maximum of 3 holds); the subject cannot approve a request about themselves', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(300_000);
    const run = await staffRun();
    const subject = run.accounts[`a4-subject-${browserName}`];
    if (!subject) throw new Error('No a4-subject fixture');
    const requester = await staffContext(context, `a4-admin-${browserName}`);
    const now = await realClock(page);

    // ADR-237: three Owners already (the seeded one, `owner`, `a4-owner`), so an approved Owner grant must fail, never make a fourth.
    const team = await pageProps<{ owners: { active: number; max: number } }>(context, '/admin/team');
    expect(team.owners, 'the Owner count A4 is written for').toEqual({ active: 3, max: 3 });
    await open(page, '/admin/team', { now });
    await expect(id(page, 'ADM-39.owners')).toHaveText(admin('team', 'index.owners', { count: '3', max: '3' }));

    const tabs = await Promise.all([0, 1, 2, 3].map(() => browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP)));
    const [ownerTab, approverTab, subjectTab, secondOwnerTab] = tabs as [typeof tabs[0], typeof tabs[0], typeof tabs[0], typeof tabs[0]];
    try {
      await staffContext(subjectTab.context, `a4-subject-${browserName}`);
      const approver = await staffContext(approverTab.context, `a4-approver-${browserName}`);
      const owner = await staffContext(ownerTab.context, 'a4-owner');
      const secondOwner = await staffContext(secondOwnerTab.context, 'owner');
      expect(await permissionsPage(subjectTab.context), 'the subject is an Admin after the first test').toBe(200);

      // An Owner asks to make the subject an Owner as well.
      await realClock(ownerTab.page);
      await chooseRoles(ownerTab.page, subject.id, { owner: true });
      const drawer = id(ownerTab.page, 'ADM-40.roles-drawer');
      await expect(drawer).toContainText(admin('team', 'roles_drawer.why.elevates'));
      await expect(drawer).toContainText(admin('team', 'roles_drawer.why.owner'));
      const ownerReason = `A4 ${browserName}: zweite Vertretung der Geschäftsführung für den Jahreswechsel`;
      await id(ownerTab.page, 'ADM-40.roles-drawer.reason').fill(ownerReason);
      await id(ownerTab.page, 'ADM-40.roles-drawer.submit').click();
      await confirmPassword(ownerTab.page);
      await expect(id(ownerTab.page, 'shell.approval')).toBeVisible();
      const grant = (await approvals(ownerTab.context, 'mine')).find((r) => r.action === 'staff.role_elevation' && r.subject_label === subject.name && r.status === 'pending');
      if (!grant) throw new Error('The Owner grant is not on the Owner\'s ADM-43');

      // An admin who holds every atom, is neither requester nor subject: still not allowed, Owner is granted.
      expect((await approvals(approverTab.context, 'all')).find((r) => r.id === grant.id)?.can_decide, 'an admin approves no Owner grant').toBe(false);
      expect(await approveDirectly(approverTab.context, grant.id), 'an admin approver gets 403 on an Owner grant').toBe(403);
      // Neither the requester nor the subject.
      expect(await approveDirectly(ownerTab.context, grant.id)).toBe(403);
      expect(await approveDirectly(subjectTab.context, grant.id), 'the subject cannot approve their own elevation').toBe(403);
      expect((await approvals(ownerTab.context, 'mine')).find((r) => r.id === grant.id)?.status).toBe('pending');

      // A second Owner may decide it; executed, the Owner maximum refuses it and nothing changes.
      await realClock(secondOwnerTab.page);
      expect((await approvals(secondOwnerTab.context, 'all')).find((r) => r.id === grant.id)?.can_decide, 'an Owner may approve an Owner grant').toBe(true);
      await approveOnAdm43(secondOwnerTab.page, subject.name, owner.name, ownerReason);
      await expect(secondOwnerTab.page.locator('[data-testid="toast.error"]:visible').filter({ hasText: admin('approvals', 'flash.failed') })).toBeVisible();
      const failed = (await approvals(secondOwnerTab.context, 'all')).find((r) => r.id === grant.id);
      expect(failed).toMatchObject({ status: 'failed', decided_by: secondOwner.name });
      expect(failed?.result.error).toBe(serverLang('team', 'refused.max_owners', { max: '3' }));
      expect((await pageProps<StaffShow>(context, `/admin/team/${subject.id}`)).member.roles).not.toContain('owner');
      expect((await pageProps<{ owners: { active: number } }>(context, '/admin/team')).owners.active).toBe(3);

      // Back to Support (taking Admin away is four-eyes, SF-6). The subject, an Admin now, holds every atom the request needs and is not
      // its requester: only Approvals::isAbout refuses them.
      await realClock(page);
      await chooseRoles(page, subject.id, { admin: false });
      const back = id(page, 'ADM-40.roles-drawer');
      await expect(id(page, 'ADM-40.roles-drawer.diff')).toContainText(`− ${admin('team', 'atoms.roles.manage')}`);
      await expect(back).toContainText(admin('team', 'roles_drawer.why.demotes'));
      const backReason = `A4 ${browserName}: Vertretung beendet, zurück in den Support`;
      await id(page, 'ADM-40.roles-drawer.reason').fill(backReason);
      await flowShot(page, testInfo, 'ADM-40-rolesDemote', { phase: 3 });
      await id(page, 'ADM-40.roles-drawer.submit').click();
      await confirmPasswordIfAsked(page, id(page, 'shell.approval'));
      await expect(id(page, 'shell.approval')).toBeVisible();
      const demote = (await approvals(context, 'mine')).find((r) => r.action === 'staff.role_elevation' && r.subject_label === subject.name && r.status === 'pending');
      if (!demote) throw new Error('The step back is not on the requester\'s ADM-43');
      expect((await approvals(subjectTab.context, 'all')).find((r) => r.id === demote.id)?.can_decide, 'the subject decides nothing about themselves').toBe(false);
      expect(await approveDirectly(subjectTab.context, demote.id), 'the subject cannot approve a request about themselves').toBe(403);
      expect((await approvals(approverTab.context, 'all')).find((r) => r.id === demote.id)?.can_decide).toBe(true);

      await approveOnAdm43(approverTab.page, subject.name, requester.name, backReason);
      await expect(toast(approverTab.page, admin('approvals', 'flash.approved'))).toBeVisible();
      expect(await permissionsPage(subjectTab.context), 'the subject\'s next request has lost roles.manage').toBe(403);
      expect((await pageProps<StaffShow>(context, `/admin/team/${subject.id}`)).member.roles).toEqual(['support']);
      const changed = (await pageProps<{ rows: { data: AuditRow[] } }>(context, `/admin/audit?filter[action]=staff.roles_changed&filter[target_id]=${subject.id}`)).rows.data;
      expect(changed.find((r) => r.reason === backReason)?.actor.label).toBe(approver.name);
      const trail = (await pageProps<{ rows: { data: AuditRow[] } }>(context, `/admin/audit?filter[target_id]=${grant.id}`)).rows.data;
      expect(trail.find((r) => r.action === 'approval.failed')?.actor.label, 'the failed Owner grant is audited').toBe(secondOwner.name);
    } finally {
      for (const tab of tabs) await tab.context.close();
    }
  });
});
