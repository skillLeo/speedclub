// A2 Report handling (02_PRODUCT_SPEC §4 A2, m3.4-contract §1–§3, 06_ADMIN_SPEC §3 Moderation, 08_LEGAL_COMPLIANCE §4 Art. 16/17/20, ADR-204,
// ADR-215), on Chromium and WebKit. Members of its own per browser project (createGarageMember, removed in afterAll with the cases,
// decisions and appeals about them), never demo members: a reporter and the owner of a build, who also writes the reported message (two
// sign-ins per project: the member login limiter allows ten a minute per address, shared by every worker). Staff of its own
// per browser project (support/backend.php STAFF_FIXTURES `a2-*`), each signed in here in a session of its own, since each confirms its
// password (ADR-215): the moderator who decides the photo, a second moderator who decides the appeal, and the moderator of the message.
//
// Photo: the reporter reports a photo of the build on VEH-04 → the case is on ADM-20 Neu → ADM-21: the evidence on request (audited),
// Übernehmen, "Inhalt entfernen" from the Spam template with edited facts behind the password dialog → the photo is gone, the reporter
// reads the outcome on SET-16 / SAFE-01, the owner SAFE-01 and the statement-of-reasons mail. Appeal: the owner appeals on SAFE-01 → the
// appeal is under Einsprüche → the deciding moderator is not offered it and the server refuses a direct POST → the second moderator
// overturns it → the photo is back, the owner reads the reversal (SAFE-01, both mails), the reporter its outcome. Message: the reporter
// reports one message of a chat → ADM-22 shows only that message and the context stored with the report (five before, two after), more
// only on request (audited) → Einschränken from the Harassment template; an analyst (moderation.view without moderation.messages) gets
// no ADM-22, no evidence and no message text in ADM-21's page data. The admin pages run on the real clock (see support/admin-flow.ts).
import type { Page } from '@playwright/test';
import {
  admin,
  choose,
  confirmPassword,
  confirmPasswordDirectly,
  DESKTOP,
  lead,
  pageProps,
  realClock,
  serverCopy,
  staffContext,
  toast,
  xsrfOf,
} from '../support/admin-flow';
import { deleteTestAccounts, runTestJobs, testCases, waitForMail } from '../support/backend.mjs';
import { noteDeletedMedia } from '../support/deleted-media.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, de, flowShot, follow, id, isCall, members, named, open, row, sendText, startConversation, type Member } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';
import { staffSession } from '../support/staff.mjs';

type SorTemplate = { id: string; key: string; locale: string; label: string; facts: string; ground: string };
type CaseProps = {
  templates: SorTemplate[];
  composer: { member_locale: string; placeholders: { target: string; date: string; member: string } };
  decision: { id: string; appeals: { id: string; status: string; text: string | null; may_decide: boolean }[] } | null;
};
type Notice = { type: string; details: { decision_id?: string | null; action?: string | null; outcome?: string | null } };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The app's copy as a pattern, any text in place of its {{values}} (the target's label is the server's). */
const copyPattern = (text: string): RegExp => new RegExp(`^${text.split(/\{\{\w+\}\}/).map(escape).join('.+')}$`);
/** A template's text with the composer's placeholders filled, as the composer does (Moderation/shared.ts fillPlaceholders). */
const filled = (text: string, values: CaseProps['composer']['placeholders']): string =>
  text.replaceAll('{target}', values.target).replaceAll('{date}', values.date).replaceAll('{member}', values.member);

async function decisionsOf(member: Member): Promise<{ id: string; action: string }[]> {
  return expectStatus(await member.api.get('me/decisions'), 200, `GET me/decisions of ${member.username}`).data;
}
async function notificationsOf(member: Member): Promise<Notice[]> {
  return expectStatus(await member.api.get('notifications'), 200, `GET notifications of ${member.username}`).data;
}
async function photoIds(member: Member, slug: string): Promise<string[]> {
  const vehicle = expectStatus(await member.api.get(`public/vehicles/${slug}`), 200, `GET public/vehicles/${slug}`).data;
  return (vehicle.photos as { id: string }[]).map((p) => p.id);
}
/** The one case about a test member's `type` target. */
async function caseAbout(member: Member, type: string): Promise<{ id: string; target_id: string; status: string }> {
  const found = (await testCases(member.email)).cases.filter((c) => c.target_type === type);
  expect(found, `one ${type} case about ${member.username}`).toHaveLength(1);
  return found[0] as { id: string; target_id: string; status: string };
}
/** A tab of a record page; one that does not fit the strip sits in the last "Mehr" menu (DQ-525). */
async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name: new RegExp(`^${escape(name)}`) });
  if ((await tab.count()) > 0) await tab.click();
  else {
    await page.getByTestId('tabs.more').click();
    await page.getByRole('menuitem', { name: new RegExp(`^${escape(name)}`) }).click();
  }
}
/** The one mail of `kind` the member's queue holds, run here (the queue worker does not run locally), then read from the mailbox. */
async function mailOf(member: Member, kind: 'SendDecisionMail' | 'SendAppealOutcomeMail', subject: string, text: string) {
  const { ran } = await runTestJobs(member.email, kind);
  expect(ran, `the decision queued its mail (${kind})`).toEqual([kind]);
  return waitForMail(member.email, (mail) => mail.subject === subject && mail.text.includes(text));
}

test.describe.configure({ mode: 'serial' });

test.describe('A2 report handling', () => {
  let reporter: Member;
  let owner: Member;
  let vehicle: { slug: string; photos: { id: string }[] };
  let prefix: string;
  let photoId: string;
  let caseId: string;
  let decisionId: string;
  let editedFacts: string;
  const appealText = 'Das Schild auf dem Foto gehört zum Treffen in Hockenheim, ich verkaufe nichts. Bitte schaut euch das noch einmal an.';

  test.beforeAll(async ({}, testInfo) => {
    // Own members per browser project, so the cleanup below removes only this project's.
    const tag = `a2${testInfo.project.name}`;
    prefix = `garage.${tag}`;
    [reporter, owner] = await members(`${tag}r`, `${tag}o`);
    await named(reporter, 'Jana Wolff');
    await named(owner, 'Kai Brandner', 'Mannheim');
    vehicle = await buildVehicle(owner.api, { photos: 2 });
  });

  test.afterAll(async () => {
    // The teardown would remove them too; this run's own go at once, with the cases, decisions and appeals about them.
    if (vehicle) noteDeletedMedia(vehicle); // its photos may still be loading in another worker's Start (support/deleted-media.mjs)
    if (prefix) await deleteTestAccounts(prefix);
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('a photo reported on VEH-04 → ADM-20 Neu → ADM-21: evidence (audited), Übernehmen, Inhalt entfernen from a template → SET-16, SAFE-01 and the mail', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(240_000);
    const sinks = { pageErrors, blockedRequests, expected: [] };

    // The reporter: VEH-04 › Melden › Spam.
    const member = await browserOf(browser, reporter, sinks);
    try {
      await open(member.page, `/app/viewer?slug=${vehicle.slug}&index=0`);
      await expect(id(member.page, 'VEH-04.viewer.counter')).toBeVisible();
      await id(member.page, 'VEH-04.report').click();
      await row(member.page, 'VEH-04.report.reason.spam').click();
      const sent = member.page.waitForResponse(isCall('POST', 'reports'));
      await id(member.page, 'VEH-04.report.send').click();
      const answer = await sent;
      expect(answer.status()).toBe(201);
      const body = answer.request().postDataJSON() as { target_type: string; target_id: string; reason: string };
      expect(body).toMatchObject({ target_type: 'photo', reason: 'spam' });
      expect(vehicle.photos.map((p) => p.id)).toContain(body.target_id);
      photoId = body.target_id;
      await expect(id(member.page, 'VEH-04.report.sent')).toBeVisible();
      await id(member.page, 'VEH-04.report.done').click();
    } finally {
      await member.context.close();
    }
    const opened = await caseAbout(owner, 'photo');
    expect(opened).toMatchObject({ target_id: photoId, status: 'new' });
    caseId = opened.id;

    // ADM-20 Neu: the case, found by its number.
    await staffContext(context, `a2-moderator-${browserName}`);
    const now = await realClock(page);
    await open(page, '/admin/moderation/reports', { now });
    await expect(page.getByRole('tab', { name: new RegExp(`^${admin('moderation', 'reports.tabs.new')}`) })).toHaveAttribute('aria-selected', 'true');
    await id(page, 'ADM-20.filter.q').fill(caseId);
    await id(page, 'ADM-20.filter.apply').click();
    const queued = id(page, 'ADM-20.open');
    await expect(queued).toHaveCount(1);
    await expect(queued).toContainText(admin('moderation', 'target_types.photo'));
    await queued.click();

    // ADM-21: new, the evidence on request (logged), then Übernehmen.
    await expect(id(page, 'ADM-21')).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/admin/moderation/cases/${caseId}`);
    await expect(id(page, 'ADM-21.status')).toHaveText(admin('moderation', 'status.new'));
    await expect(id(page, 'ADM-21.preview')).toBeVisible();
    await openTab(page, admin('moderation', 'case.tabs.evidence'));
    await expect(page.locator('[data-testid="ADM-21.evidence"][data-evidence-state="idle"]')).toBeVisible();
    const evidence = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/admin/moderation/cases/${caseId}/evidence`);
    await id(page, 'ADM-21.evidence.reveal').click();
    expect((await evidence).status()).toBe(200);
    await expect(page.locator('[data-testid="ADM-21.evidence"][data-evidence-state="ready"]')).toBeVisible();
    await expect(id(page, 'ADM-21.evidence.logged')).toBeVisible();
    await expect(id(page, 'ADM-21.evidence.report')).toHaveCount(1);
    await flowShot(page, testInfo, 'ADM-21-evidenceRevealed', { phase: 3 });

    await id(page, 'ADM-21.take').click();
    await expect(toast(page, admin('moderation', 'flash.taken'))).toBeVisible();
    await expect(id(page, 'ADM-21.status')).toHaveText(admin('moderation', 'status.in_review'));
    await expect(id(page, 'ADM-21.meta')).toContainText(admin('moderation', 'case.meta.assigned', { name: admin('moderation', 'reports.you') }));
    await expect(id(page, 'ADM-21.take')).toHaveCount(0);

    // The composer: Inhalt entfernen, the Spam template in the member's language with its placeholders filled, the facts edited.
    const props = await pageProps<CaseProps>(context, `/admin/moderation/cases/${caseId}`);
    const template = props.templates.find((t) => t.key === 'spam' && t.locale === props.composer.member_locale);
    if (!template) throw new Error(`No spam template in ${props.composer.member_locale}`);
    await id(page, 'ADM-21.decide').click();
    const composer = id(page, 'ADM-21.composer');
    await expect(composer).toBeVisible();
    await composer.getByRole('radio', { name: new RegExp(`^${admin('moderation', 'composer.actions.remove_content')}`) }).check();
    await choose(page, composer, admin('moderation', 'composer.template'), template.label);
    const facts = id(page, 'ADM-21.composer.facts');
    await expect(facts).toHaveValue(filled(template.facts, props.composer.placeholders));
    await expect(id(page, 'ADM-21.composer.ground')).toHaveValue(filled(template.ground, props.composer.placeholders));
    editedFacts = `${filled(template.facts, props.composer.placeholders)} Auf dem Bild steht eine Telefonnummer für den Verkauf von Felgen.`;
    await facts.fill(editedFacts);
    await id(page, 'ADM-21.composer.reason').fill(`A2 ${browserName}: Werbeschild mit Telefonnummer auf dem Foto, Meldung bestätigt`);
    await expect(id(page, 'ADM-21.composer.preview.de')).toContainText(editedFacts);
    await flowShot(page, testInfo, 'ADM-21-composerRemoveContent', { phase: 3 });
    // The decision takes the photo (the build's cover) off the public disk: another worker's Start may still be loading it.
    noteDeletedMedia([{ id: photoId }]);
    await id(page, 'ADM-21.composer.submit').click();
    await confirmPassword(page);
    await expect(toast(page, admin('moderation', 'flash.decided'))).toBeVisible();
    await expect(composer).toBeHidden();
    await expect(id(page, 'ADM-21.status')).toHaveText(admin('moderation', 'status.decided'));

    // The history: the evidence view, the assignment and the decision are audit events of the case.
    await page.reload();
    const history = id(page, 'ADM-21.activity');
    for (const action of ['evidence_viewed', 'case_assigned', 'decided']) await expect(history, action).toContainText(admin('audit', `actions.moderation.${action}`));

    // The photo is gone for everyone.
    expect(await photoIds(reporter, vehicle.slug)).not.toContain(photoId);

    // The owner: the decision, its notification and the statement-of-reasons mail with the facts as written and the full redress.
    const removal = (await decisionsOf(owner)).find((d) => d.action === 'remove_content');
    if (!removal) throw new Error('The owner has no remove_content decision');
    decisionId = removal.id;
    expect((await notificationsOf(owner)).filter((n) => n.type === 'moderation_decision' && n.details.decision_id === decisionId)).toHaveLength(1);
    const mail = await mailOf(owner, 'SendDecisionMail', serverCopy('mail.decision.subject'), editedFacts);
    expect(mail.text).toContain(template.ground);
    for (const line of ['mail.decision.detection_no', 'mail.decision.decision_no', 'mail.decision.redress.internal_complaint', 'mail.decision.redress.out_of_court', 'mail.decision.redress.court']) {
      expect(mail.text, line).toContain(lead(serverCopy(line)));
    }
    const affected = await browserOf(browser, owner, sinks);
    try {
      await open(affected.page, `/app/decision/${decisionId}`);
      await expect(id(affected.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleAffected.remove_content'));
      await expect(id(affected.page, 'SAFE-01.outcome')).toHaveText(copyPattern(de('safety', 'decision.outcome.remove_content')));
      await expect(id(affected.page, 'SAFE-01.facts')).toHaveText(editedFacts);
      await expect(id(affected.page, 'SAFE-01.groundText')).toContainText(template.ground);
      await expect(id(affected.page, 'SAFE-01.appealButton')).toBeEnabled();
      await flowShot(affected.page, testInfo, 'SAFE-01-photoRemovedByStaff', { phase: 3 });
    } finally {
      await affected.context.close();
    }

    // The reporter: SET-16 says Entschieden; SAFE-01 has the outcome and nothing about the other member.
    const filed = expectStatus(await reporter.api.get('me/reports'), 200, 'GET me/reports').data as { id: string; decision: { id: string } | null }[];
    expect(filed).toHaveLength(1);
    expect(filed[0]?.decision?.id).toBe(decisionId);
    expect((await notificationsOf(reporter)).filter((n) => n.type === 'report_decided' && n.details.decision_id === decisionId).map((n) => n.details.outcome)).toEqual(['remove_content']);
    const reporting = await browserOf(browser, reporter, sinks);
    try {
      await open(reporting.page, '/app/settings/reports');
      const reportRow = id(reporting.page, `SET-16.report.${filed[0]?.id}`);
      await expect(reportRow).toContainText(de('safety', 'status.decided'));
      await reportRow.click();
      await expect.poll(() => new URL(reporting.page.url()).pathname).toBe(`/app/decision/${decisionId}`);
      await expect(id(reporting.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleReporter'));
      await expect(id(reporting.page, 'SAFE-01.outcome')).toHaveText(copyPattern(de('safety', 'decision.reporterOutcome.remove_content')));
      await expect(id(reporting.page, 'SAFE-01.reporterNote')).toBeVisible();
      // A reporter may appeal too (Art. 20(1) DSA), so only the affected member's statement is hidden.
      for (const hidden of ['SAFE-01.facts', 'SAFE-01.groundText']) await expect(id(reporting.page, hidden), hidden).toHaveCount(0);
    } finally {
      await reporting.context.close();
    }
  });

  test('the owner appeals → Einsprüche → refused for the deciding moderator → a second moderator overturns it: the photo is back, both are told', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(240_000);
    const sinks = { pageErrors, blockedRequests, expected: [] };

    // The owner appeals on SAFE-01.
    const affected = await browserOf(browser, owner, sinks);
    try {
      await open(affected.page, `/app/decision/${decisionId}`);
      await id(affected.page, 'SAFE-01.appealButton').click();
      await expect(id(affected.page, 'SAFE-01.appealSheet')).toBeVisible();
      await id(affected.page, 'SAFE-01.appealSheet.text').fill(appealText);
      const appealed = affected.page.waitForResponse(isCall('POST', `decisions/${decisionId}/appeal`));
      await id(affected.page, 'SAFE-01.appealSheet.send').click();
      expect((await appealed).status()).toBe(201);
      await expect(id(affected.page, 'SAFE-01.appealSheet.sent')).toBeVisible();
    } finally {
      await affected.context.close();
    }

    // The deciding moderator: the appeal is under Einsprüche, but not theirs to decide.
    await staffContext(context, `a2-moderator-${browserName}`);
    const now = await realClock(page);
    await open(page, '/admin/moderation/reports?tab=appeals', { now });
    await expect(page.getByRole('tab', { name: new RegExp(`^${admin('moderation', 'reports.tabs.appeals')}`) })).toHaveAttribute('aria-selected', 'true');
    const appealRow = id(page, 'ADM-20.open').filter({ hasText: `@${owner.username}` });
    await expect(appealRow).toHaveCount(1);
    await appealRow.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/admin/moderation/cases/${caseId}`);
    await openTab(page, admin('moderation', 'case.tabs.decision'));
    const appealItem = id(page, 'ADM-21.appeal');
    await expect(appealItem).toHaveCount(1);
    await expect(appealItem).toContainText(appealText);
    await expect(appealItem).toContainText(admin('moderation', 'appeal_status.open'));
    await expect(id(page, 'ADM-21.appeal.decide')).toHaveCount(0);
    await expect(id(page, 'ADM-21.appeal.same-staff')).toHaveText(admin('moderation', 'case.appeals.same_staff'));
    await flowShot(page, testInfo, 'ADM-21-appealSameStaff', { phase: 3 });

    // The server refuses it too (Art. 20(6) DSA), with a fresh password so the refusal is the rule's and not the password prompt.
    const props = await pageProps<CaseProps>(context, `/admin/moderation/cases/${caseId}`);
    const appeal = props.decision?.appeals[0];
    if (!appeal) throw new Error('The case has no appeal');
    expect(appeal).toMatchObject({ status: 'open', may_decide: false });
    await confirmPasswordDirectly(context);
    const direct = await context.request.post(`/admin/moderation/appeals/${appeal.id}/decide`, {
      headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(context) },
      data: { outcome: 'reversed', explanation: 'Ich hebe meine eigene Entscheidung auf.', reason: `A2 ${browserName}: direkter Versuch der entscheidenden Person` },
      maxRedirects: 0,
    });
    expect(direct.status(), 'the moderator who decided cannot decide the appeal').toBe(403);
    expect((await pageProps<CaseProps>(context, `/admin/moderation/cases/${caseId}`)).decision?.appeals[0]?.status).toBe('open');

    // A second moderator, in a browser of their own, overturns it behind the password dialog.
    const explanation = 'Das Schild gehört zur Veranstaltung und bewirbt keinen Verkauf. Wir haben das Foto wiederhergestellt.';
    const second = await browserOf(browser, null, sinks, DESKTOP);
    try {
      await staffContext(second.context, `a2-appeals-${browserName}`);
      const secondNow = await realClock(second.page);
      await open(second.page, `/admin/moderation/cases/${caseId}?tab=decision`, { now: secondNow });
      await expect(id(second.page, 'ADM-21.decision')).toBeVisible();
      await id(second.page, 'ADM-21.appeal.decide').click();
      const dialog = id(second.page, 'ADM-21.appeal-dialog');
      await expect(dialog).toBeVisible();
      await expect(id(second.page, 'ADM-21.appeal-dialog.text')).toHaveText(appealText);
      await dialog.getByRole('radio', { name: new RegExp(`^${admin('moderation', 'appeal.reversed')}`) }).check();
      await id(second.page, 'ADM-21.appeal-dialog.explanation').fill(explanation);
      await id(second.page, 'ADM-21.appeal-dialog.reason').fill(`A2 ${browserName}: Einspruch begründet, Veranstaltungsschild statt Werbung`);
      await flowShot(second.page, testInfo, 'ADM-21-appealDialogReversed', { phase: 3 });
      await id(second.page, 'ADM-21.appeal-dialog.submit').click();
      await confirmPassword(second.page);
      await expect(toast(second.page, admin('moderation', 'flash.appeal_decided'))).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(id(second.page, 'ADM-21.appeal')).toContainText(admin('moderation', 'appeal_status.reversed'));
      await expect(id(second.page, 'ADM-21.appeal.decide')).toHaveCount(0);
    } finally {
      await second.context.close();
    }

    // The photo is back.
    expect(await photoIds(reporter, vehicle.slug)).toContain(photoId);

    // The owner: the reversal on SAFE-01, its notification, the reversal mail and the appeal outcome mail.
    const reversal = (await decisionsOf(owner)).find((d) => d.action === 'reverse');
    if (!reversal) throw new Error('The owner has no reverse decision');
    expect((await notificationsOf(owner)).filter((n) => n.type === 'moderation_decision' && n.details.decision_id === reversal.id).map((n) => n.details.action)).toEqual(['reverse']);
    const reversed = await mailOf(owner, 'SendDecisionMail', serverCopy('mail.reversed.subject'), explanation);
    expect(reversed.text).toContain(serverCopy('mail.reversed.lifted.remove_content'));
    const outcome = await mailOf(owner, 'SendAppealOutcomeMail', serverCopy('mail.appeal.subject'), explanation);
    expect(outcome.text).toContain(serverCopy('mail.appeal.reversed'));
    const affectedAgain = await browserOf(browser, owner, sinks);
    try {
      await open(affectedAgain.page, `/app/decision/${reversal.id}`);
      await expect(id(affectedAgain.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleAffected.reverse'));
      await expect(id(affectedAgain.page, 'SAFE-01.outcome')).toHaveText(copyPattern(de('safety', 'decision.outcome.reverseContent')));
      await expect(id(affectedAgain.page, 'SAFE-01.original')).toBeVisible();
      await flowShot(affectedAgain.page, testInfo, 'SAFE-01-photoRestoredOnAppeal', { phase: 3 });
    } finally {
      await affectedAgain.context.close();
    }

    // The reporter: told of the reversal, and reads its outcome on SAFE-01.
    expect((await notificationsOf(reporter)).filter((n) => n.type === 'report_decided' && n.details.decision_id === reversal.id).map((n) => n.details.outcome)).toEqual(['reversed']);
    const reporting = await browserOf(browser, reporter, sinks);
    try {
      await open(reporting.page, `/app/decision/${reversal.id}`);
      await expect(id(reporting.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleReporter'));
      await expect(id(reporting.page, 'SAFE-01.outcome')).toHaveText(copyPattern(de('safety', 'decision.reporterOutcome.reversed')));
      await expect(id(reporting.page, 'SAFE-01.facts')).toHaveCount(0);
    } finally {
      await reporting.context.close();
    }
  });

  test('a reported message on ADM-22: only it and its stored context, more on request; Einschränken; an analyst sees no message text', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    test.setTimeout(240_000);
    const sinks = { pageErrors, blockedRequests, expected: [] };

    // A chat of eleven messages; the reporter reports the eighth after the tenth was written, and the eleventh comes after the report.
    await follow(reporter, owner.username);
    const lines = [
      [owner, 'Hast du die BBS LM noch?'],
      [reporter, 'Ja, 19 Zoll, frisch gepulvert.'],
      [owner, 'Was willst du dafuer haben?'],
      [reporter, '1800 Euro, Abholung in Koeln.'],
      [owner, 'Viel zu teuer fuer gebrauchte Felgen.'],
      [reporter, 'Das ist der Marktpreis, schau gern nach.'],
      [owner, 'Dann behalt sie halt.'],
      [owner, `Du bist echt der letzte Abzocker ${browserName}, lass dich beim Treffen nie wieder blicken.`],
      [reporter, 'Bitte bleib sachlich.'],
      [owner, 'Sonst was? Meldest du mich?'],
    ] as const;
    const started = await startConversation(owner, reporter.username, lines[0][1]);
    expect(started.conversation.request_pending).toBe(false);
    const ids = [started.message.id];
    for (const [from, text] of lines.slice(1)) ids.push((await sendText(from, started.conversation.id, text)).id);

    // The reporter, in the member web: the eighth message's actions › Melden › Belästigung, with the note that the context is kept.
    const member = await browserOf(browser, reporter, sinks);
    try {
      await open(member.page, `/app/messages/${started.conversation.id}`);
      await member.page.locator('[data-testid^="MSG-02.message."][data-testid$=".press"]:visible').filter({ hasText: lines[7][1] }).click();
      await row(member.page, 'MSG-02.actions.report').click();
      await row(member.page, 'MSG-02.report.reason.harassment').click();
      await expect(id(member.page, 'MSG-02.report.messageNote')).toBeVisible();
      const sent = member.page.waitForResponse(isCall('POST', 'reports'));
      await id(member.page, 'MSG-02.report.send').click();
      const answer = await sent;
      expect(answer.status()).toBe(201);
      expect(answer.request().postDataJSON()).toMatchObject({ target_type: 'message', target_id: ids[7], reason: 'harassment', message_context: true });
      await expect(id(member.page, 'MSG-02.report.sent')).toBeVisible();
    } finally {
      await member.context.close();
    }
    const later = `Ich erzaehle allen im Club ${browserName}, was du fuer einer bist.`;
    await sendText(owner, started.conversation.id, later);
    const bodies = [...lines.map(([, text]) => text), later];
    const messageCase = await caseAbout(owner, 'message');
    expect(messageCase).toMatchObject({ target_id: ids[7], status: 'new' });

    // ADM-22 as a moderator: the reported message and the five before and two after it, nothing else of the chat.
    await staffContext(context, `a2-messages-${browserName}`);
    const now = await realClock(page);
    await open(page, `/admin/moderation/messages?case=${messageCase.id}`, { now });
    await expect(id(page, 'ADM-22.participants')).toContainText(owner.username);
    await expect(id(page, 'ADM-22.participants')).toContainText(reporter.username);
    await expect(page.locator('[data-testid="ADM-22.evidence"][data-evidence-state="ready"]')).toBeVisible();
    await expect(id(page, 'ADM-22.evidence.logged')).toBeVisible();
    await expect(id(page, 'ADM-22.evidence.reported-message')).toHaveCount(1);
    await expect(id(page, 'ADM-22.evidence.reported-message')).toContainText(bodies[7] as string);
    const context7 = id(page, 'ADM-22.evidence.context-message');
    await expect(context7).toHaveCount(7);
    for (const index of [2, 3, 4, 5, 6, 8, 9]) await expect(context7.filter({ hasText: bodies[index] as string }), `message ${index + 1} is context`).toHaveCount(1);
    const stored = id(page, 'ADM-22.evidence');
    for (const index of [0, 1, 10]) await expect(stored, `message ${index + 1} is not shown`).not.toContainText(bodies[index] as string);
    await flowShot(page, testInfo, 'ADM-22-evidenceContext', { phase: 3 });

    // More only on request: the live messages around it (audited separately), which include the one written after the report.
    const live = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/admin/moderation/cases/${messageCase.id}/live-context`);
    await id(page, 'ADM-22.evidence.live').click();
    expect((await live).status()).toBe(200);
    await expect(id(page, 'ADM-22.evidence.live-list')).toContainText(later);

    // Einschränken from ADM-22: messaging for 7 days, the Harassment template with edited facts, behind the password dialog.
    const props = await pageProps<{ templates: SorTemplate[]; selected: { composer: CaseProps['composer'] } }>(context, `/admin/moderation/messages?case=${messageCase.id}`);
    const template = props.templates.find((t) => t.key === 'harassment' && t.locale === props.selected.composer.member_locale);
    if (!template) throw new Error('No harassment template');
    await id(page, 'ADM-22.decide').click();
    const composer = id(page, 'ADM-22.composer');
    await expect(composer).toBeVisible();
    await composer.getByRole('radio', { name: new RegExp(`^${admin('moderation', 'composer.actions.restrict')}`) }).check();
    await expect(composer.getByRole('radio', { name: new RegExp(`^${admin('decisions', 'measures.messaging')}`) })).toBeChecked();
    await expect(composer.getByRole('combobox', { name: new RegExp(`^${admin('decisions', 'duration')}`) })).toContainText(admin('decisions', 'durations.7'));
    await choose(page, composer, admin('moderation', 'composer.template'), template.label);
    const facts = `${filled(template.facts, props.selected.composer.placeholders)} Die Nachricht fiel nach einem abgelehnten Preisvorschlag.`;
    await id(page, 'ADM-22.composer.facts').fill(facts);
    await id(page, 'ADM-22.composer.reason').fill(`A2 ${browserName}: Beleidigung nach Absage im Chat, Meldung bestätigt`);
    // What the member will read, before deciding (DE/EN preview of SAFE-01 and the mail).
    await expect(id(page, 'ADM-22.composer.preview.de')).toContainText(facts);
    await id(page, 'ADM-22.composer.submit').click();
    await confirmPassword(page);
    await expect(toast(page, admin('moderation', 'flash.decided'))).toBeVisible();
    await expect(id(page, 'ADM-22.decision')).toContainText(admin('moderation', 'outcomes.restrict'));
    expect((await decisionsOf(owner)).map((d) => d.action)).toContain('restrict');
    const restriction = (await decisionsOf(owner)).find((d) => d.action === 'restrict');
    expect((await notificationsOf(reporter)).filter((n) => n.type === 'report_decided' && n.details.decision_id === restriction?.id).map((n) => n.details.outcome)).toEqual(['measures']);
    const mail = await mailOf(owner, 'SendDecisionMail', serverCopy('mail.decision.subject'), facts);
    expect(mail.text).toContain(template.ground);

    // An analyst (moderation.view, not moderation.messages): no ADM-22, no evidence, and no message text in ADM-21's page data.
    const analyst = await browserOf(browser, null, sinks, DESKTOP);
    try {
      await analyst.context.addCookies(await staffSession('staff-analyst'));
      const queue = await analyst.context.request.get(`/admin/moderation/messages?case=${messageCase.id}`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
      expect(queue.status(), 'ADM-22 needs moderation.messages').toBe(403);
      const record = await analyst.context.request.get(`/admin/moderation/cases/${messageCase.id}`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
      expect(record.status()).toBe(200);
      const html = await record.text();
      for (const text of bodies) expect(html, 'no message text reaches an analyst').not.toContain(text);
      const reveal = await analyst.context.request.post(`/admin/moderation/cases/${messageCase.id}/evidence`, {
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst.context) },
        maxRedirects: 0,
      });
      expect(reveal.status(), 'the evidence of a message case needs moderation.messages').toBe(403);

      const analystNow = await realClock(analyst.page);
      await open(analyst.page, `/admin/moderation/cases/${messageCase.id}`, { now: analystNow });
      await expect(id(analyst.page, 'ADM-21.preview.message')).toBeVisible();
      await expect(id(analyst.page, 'ADM-21.preview.message').locator('a')).toHaveCount(0);
      await expect(id(analyst.page, 'ADM-21.decide')).toHaveCount(0);
      await openTab(analyst.page, admin('moderation', 'case.tabs.evidence'));
      await expect(id(analyst.page, 'ADM-21.evidence.forbidden')).toBeVisible();
      await expect(id(analyst.page, 'ADM-21.evidence.reveal')).toHaveCount(0);
      await flowShot(analyst.page, testInfo, 'ADM-21-analystMessageCase', { phase: 3 });
    } finally {
      await analyst.context.close();
    }
  });
});
