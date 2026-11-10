// F6 Messaging safety (02_PRODUCT_SPEC §4 F6, 04_SCREEN_REGISTER §6 "F6 MSG-01(Anfragen) → MSG-04 → SAFE report"; m2.4- and
// m2.6-api-handover.md): a request opens in MSG-04 without telling the sender (no read receipt), Annehmen moves it to Chats, Löschen is
// a silent decline (the sender stays `request_pending`), "Blockieren und melden" hides both members from each other, ends the
// conversation and files a report; reports from PROF-02, VEH-01 and a message, where an illegal report needs an explanation; SET-16
// lists them; the seeded decision on SAFE-01 in the affected and the reporter view (read only); an appeal of a member of its own up to
// its sent state; WEB-09 /melden as a guest.
//
// Everything that writes uses members of this spec. The seeded decision (tobi.quattro affected, nico.sti reporter) is only read: no
// appeal is filed on it, since the visual matrix photographs its open appeal. The report sheet and the block dialog open on a tap and
// are saved as pictures for design QA under docs/reports/visual/phase-2/flows/.
import type { Page } from '@playwright/test';
import { applyAuth, DEMO_REPORTER, sessionOf, useSession } from '../support/auth.mjs';
import { decideTestCase } from '../support/backend.mjs';
import { expect, test, type ExpectedFailure } from '../support/fixtures';
import {
  apiPath,
  clientId,
  browserOf,
  de,
  flowShot,
  follow,
  id,
  inbox,
  isCall,
  members,
  named,
  open,
  pathOf,
  row,
  startConversation,
  webPath,
  type Member,
} from '../support/flow';
import { buildVehicle, demoIds, expectStatus, memberApi } from '../support/garage.mjs';
import { BASE_URL, qaUrl } from '../support/qa.mjs';


/** What a hidden conversation and member cost in the browser: 404s by design. */
function hidden(conversationId: string, username?: string): ExpectedFailure[] {
  const failures: ExpectedFailure[] = [
    { status: 404, url: apiPath(`conversations/${conversationId}`) },
    { status: 404, url: apiPath(`conversations/${conversationId}/messages`) },
  ];
  if (username) failures.push({ status: 404, url: new RegExp(`/api/v1/public/users/${username.replace(/\./g, '\\.')}(/[a-z]+)?(\\?.*)?$`) });
  return failures;
}

async function myReports(member: Member): Promise<{ id: string; target: { type: string; label: string }; reason: string; sub_reason: string | null; status: string }[]> {
  return expectStatus(await member.api.get('me/reports'), 200, `GET me/reports of ${member.username}`).data;
}

/** Walks the report sheet `<routeId>.report` from the reason to the sent step. */
async function report(page: Page, routeId: string, reason: string, details?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const sheet = `${routeId}.report`;
  await expect(id(page, `${sheet}.reason.${reason}`)).toBeVisible();
  await row(page, `${sheet}.reason.${reason}`).click();
  if (details) await id(page, `${sheet}.details`).fill(details);
  const sent = page.waitForResponse(isCall('POST', 'reports'));
  await id(page, `${sheet}.send`).click();
  const answer = await sent;
  await expect(id(page, `${sheet}.sent`)).toBeVisible();
  return { status: answer.status(), body: answer.request().postDataJSON() };
}

test.describe('F6 requests', () => {
  test('MSG-04 shows a request without a read receipt to the sender; Annehmen moves it to Chats', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(150_000);
    const [sender, recipient] = await members('f6sender', 'f6recipient');
    await named(sender, 'Tim Wagner');
    const text = 'Hi, verkaufst du den Ladeluftkühler?';
    const { conversation } = await startConversation(sender, recipient.username, text);
    expect(conversation.folder).toBe('chats');
    expect(conversation.request_pending).toBe(true);

    await useSession(context, recipient.session);
    await open(page, '/app/messages?folder=requests');
    await id(page, `MSG-01.row.${conversation.id}.open`).click();
    await expect.poll(() => pathOf(page)).toBe(`/app/messages/requests/${conversation.id}`);
    await expect(id(page, 'MSG-04.request.title')).toHaveText(de('messages', 'request.banner', { username: sender.username }));
    await expect(page.locator('[data-testid^="MSG-04.message."]:visible').filter({ hasText: text }).first()).toBeVisible();
    await expect(id(page, 'MSG-04.composer')).toHaveCount(0);
    await expect(page.locator('[data-testid^="MSG-04.message."][data-testid$=".read"]')).toHaveCount(0);

    // Opening it told the sender nothing: no read mark, no receipt, still pending.
    const seen = expectStatus(await sender.api.get(`conversations/${conversation.id}`), 200, 'GET conversation as sender').data;
    expect(seen.other_read_message_id).toBeNull();
    expect(seen.request_pending).toBe(true);
    const theirs = await browserOf(browser, sender, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(theirs.page, `/app/messages/${conversation.id}`);
      await expect(id(theirs.page, 'MSG-02.requestPending')).toBeVisible();
      await expect(theirs.page.locator('[data-testid^="MSG-02.message."][data-testid$=".read"]')).toHaveCount(0);

      const accepted = page.waitForResponse(isCall('POST', `conversations/${conversation.id}/accept`));
      await id(page, 'MSG-04.request.accept').click();
      expect((await accepted).status()).toBe(200);
      await expect(id(page, 'MSG-04.toast')).toHaveText(de('messages', 'request.accepted'));
      expect((await inbox(recipient, 'chats')).map((c) => c.id)).toContain(conversation.id);
      expect((await inbox(recipient, 'requests')).map((c) => c.id)).not.toContain(conversation.id);

      // The sender may write again.
      expect(expectStatus(await sender.api.get(`conversations/${conversation.id}`), 200, 'GET conversation').data.request_pending).toBe(false);
      await theirs.page.reload();
      await expect(id(theirs.page, 'MSG-02.composer')).toBeVisible();
    } finally {
      await theirs.context.close();
    }
  });

  test('Löschen is a silent decline: gone for the recipient, the sender stays request_pending', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const [sender, recipient] = await members('f6declinefrom', 'f6declineto');
    const { conversation } = await startConversation(sender, recipient.username, 'Hast du Lust auf ein Treffen?');
    await useSession(context, recipient.session);
    await open(page, `/app/messages/requests/${conversation.id}`);
    await id(page, 'MSG-04.request.decline').click();
    await expect(id(page, 'MSG-04.declineDialog')).toBeVisible();
    await flowShot(page, testInfo, 'MSG-04-declineDialog');
    const declined = page.waitForResponse(isCall('POST', `conversations/${conversation.id}/decline`));
    await id(page, 'MSG-04.declineDialog.confirm').click();
    expect((await declined).status()).toBe(204);
    await expect(id(page, 'MSG-04.toast')).toHaveText(de('messages', 'request.declined'));
    await expect.poll(() => pathOf(page)).toMatch(/^\/app\/messages\/?$/);
    expect(await inbox(recipient, 'requests')).toEqual([]);
    expect(await inbox(recipient, 'chats')).toEqual([]);

    // Nothing changes for the sender: still pending, and a second message is still 409 request_pending.
    const seen = expectStatus(await sender.api.get(`conversations/${conversation.id}`), 200, 'GET conversation as sender').data;
    expect(seen.request_pending).toBe(true);
    const again = await sender.api.post(`conversations/${conversation.id}/messages`, { type: 'text', body: 'Noch einmal', client_id: clientId() });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('request_pending');
  });

  test('"Blockieren und melden" hides both ways, ends the conversation and files a report', async ({ page, context, expectFailedResponses }, testInfo) => {
    test.setTimeout(150_000);
    const [sender, recipient] = await members('f6blockfrom', 'f6blockto');
    const { conversation } = await startConversation(sender, recipient.username, 'Melde dich, sonst passiert was.');
    expectFailedResponses(hidden(conversation.id, sender.username));
    await useSession(context, recipient.session);
    await open(page, `/app/messages/requests/${conversation.id}`);
    // The request's message on screen first: until the thread has loaded, the flow's target is the member, which is reported first
    // and blocked after (conversationTarget, reportableAfterBlock), and the label is the same. Verify of 2026-11-08, WebKit.
    await expect(page.locator('[data-testid^="MSG-04.message."]:visible').filter({ hasText: 'Melde dich, sonst passiert was.' }).first()).toBeVisible();
    await expect(id(page, 'MSG-04.request.block')).toHaveText(de('safety', 'block.reportConfirm'));
    await id(page, 'MSG-04.request.block').click();
    // A message stays reportable across a block, so the block comes first, then the report (useReport).
    await expect(id(page, 'MSG-04.reportBlock')).toBeVisible();
    await flowShot(page, testInfo, 'MSG-04-blockAndReportDialog');
    const blocked = page.waitForResponse(isCall('POST', `users/${sender.username}/block`));
    await id(page, 'MSG-04.reportBlock.confirm').click();
    expect((await blocked).status()).toBeLessThan(300);
    await expect(id(page, 'MSG-04.report')).toBeVisible();
    await flowShot(page, testInfo, 'MSG-04-reportSheet-reason');
    const filed = await report(page, 'MSG-04', 'harassment');
    expect(filed.status).toBe(201);
    expect(filed.body).toMatchObject({ target_type: 'message', reason: 'harassment' });
    await flowShot(page, testInfo, 'MSG-04-reportSheet-sent');
    await id(page, 'MSG-04.report.done').click();
    await expect.poll(() => pathOf(page)).toMatch(/^\/app\/messages\/?$/);

    // Both sides: the conversation is gone, the profiles hide each other, a new start is refused.
    expect((await recipient.api.get(`conversations/${conversation.id}`)).status).toBe(404);
    expect((await sender.api.get(`conversations/${conversation.id}`)).status).toBe(404);
    expect((await recipient.api.get(`public/users/${sender.username}`)).status).toBe(404);
    expect((await sender.api.get(`public/users/${recipient.username}`)).status).toBe(404);
    const restart = await sender.api.post('conversations', { recipient: recipient.username, message: { type: 'text', body: 'Hallo?' }, client_id: clientId() });
    expect(restart.status).toBe(403);
    expect(restart.body).toMatchObject({ code: 'cannot_message', reason: 'recipient_closed' });
    // The report is on record for the reporter (an admin case behind it, ADM-20).
    expect((await myReports(recipient)).map((r) => [r.target.type, r.reason])).toEqual([['message', 'harassment']]);
  });
});

test.describe('F6 reports', () => {
  test('reports from PROF-02, VEH-01 and a message; an illegal report needs an explanation; SET-16 lists all three', async ({ page, context }, testInfo) => {
    test.setTimeout(180_000);
    const [reporter, author] = await members('f6reporter', 'f6author');
    await named(author, 'Kai Neumann');
    const vehicle = await buildVehicle(author.api);
    await useSession(context, reporter.session);

    // PROF-02 › more › Melden.
    await open(page, `/app/u/${author.username}`);
    await id(page, 'PROF-02.more').click();
    await row(page, 'PROF-02.moreSheet.report').click();
    await expect(id(page, 'PROF-02.report.target')).toBeVisible();
    await flowShot(page, testInfo, 'PROF-02-reportSheet-reason');
    expect((await report(page, 'PROF-02', 'spam')).body).toMatchObject({ target_type: 'member', target_id: author.username, reason: 'spam' });
    await id(page, 'PROF-02.report.done').click();

    // VEH-01 › more › Melden, illegal: sub-reason, then an explanation of at least 10 characters before anything is sent.
    await open(page, `/app/v/${vehicle.slug}`);
    await id(page, 'VEH-01.moreActions').click();
    await row(page, 'VEH-01.moreSheet.report').click();
    await row(page, 'VEH-01.report.reason.illegal').click();
    await expect(id(page, 'VEH-01.report.subReason.street_racing')).toBeVisible();
    await flowShot(page, testInfo, 'VEH-01-reportSheet-subReason');
    await row(page, 'VEH-01.report.subReason.street_racing').click();
    await expect(id(page, 'VEH-01.report.goodFaith')).toHaveText(de('safety', 'report.goodFaith'));
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/reports') posts.push(r.url());
    });
    await id(page, 'VEH-01.report.send').click();
    await expect(id(page, 'VEH-01.report.details.error')).toBeVisible();
    await flowShot(page, testInfo, 'VEH-01-reportSheet-detailsRequired');
    expect(posts, 'nothing is sent without the explanation').toEqual([]);
    await id(page, 'VEH-01.report.details').fill('Zu kurz');
    await expect(id(page, 'VEH-01.report.send')).toBeDisabled();
    await id(page, 'VEH-01.report.details').fill('Im Video verabredet er ein Rennen auf der B9 bei Nacht.');
    const sent = page.waitForResponse(isCall('POST', 'reports'));
    await id(page, 'VEH-01.report.send').click();
    const answer = await sent;
    expect(answer.status()).toBe(201);
    expect(answer.request().postDataJSON()).toMatchObject({
      target_type: 'vehicle',
      target_id: vehicle.id,
      reason: 'illegal',
      sub_reason: 'street_racing',
      good_faith: true,
      details: 'Im Video verabredet er ein Rennen auf der B9 bei Nacht.',
    });
    await expect(id(page, 'VEH-01.report.sent')).toBeVisible();
    await id(page, 'VEH-01.report.done').click();

    // A message of the author: the actions of the bubble › Melden, with the note about the context.
    await follow(reporter, author.username);
    const { conversation } = await startConversation(author, reporter.username, 'Du hast doch keine Ahnung von Autos.');
    await open(page, `/app/messages/${conversation.id}`);
    await page.locator('[data-testid^="MSG-02.message."][data-testid$=".press"]:visible').filter({ hasText: 'keine Ahnung' }).click();
    await row(page, 'MSG-02.actions.report').click();
    await row(page, 'MSG-02.report.reason.harassment').click();
    await expect(id(page, 'MSG-02.report.messageNote')).toBeVisible();
    const fromMessage = page.waitForResponse(isCall('POST', 'reports'));
    await id(page, 'MSG-02.report.send').click();
    expect((await fromMessage).request().postDataJSON()).toMatchObject({ target_type: 'message', reason: 'harassment' });
    await expect(id(page, 'MSG-02.report.sent')).toBeVisible();
    await id(page, 'MSG-02.report.done').click();

    const filed = await myReports(reporter);
    expect(filed.map((r) => r.target.type).sort()).toEqual(['member', 'message', 'vehicle']);
    expect(filed.every((r) => r.status === 'received')).toBe(true);

    // SET-16 "Meine Meldungen" lists the three, newest first.
    await open(page, '/app/settings/reports');
    for (const r of filed) await expect(id(page, `SET-16.report.${r.id}`)).toBeVisible();
    await flowShot(page, testInfo, 'SET-16-threeReports');
  });

  test('the seeded decision on SAFE-01: the affected member reads everything, the reporter the outcome only', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(120_000);
    // The seeded decision of ModerationDemoSeeder (m2.6-api-handover.md §7); its id is new after every seed.
    const SEEDED_DECISION = (await demoIds()).decision;
    await applyAuth(context, 'member-affected');
    await open(page, `/app/decision/${SEEDED_DECISION}`);
    await expect(id(page, 'SAFE-01.title')).toBeVisible();
    for (const section of ['decided', 'content', 'facts', 'ground', 'automated', 'redress']) await expect(id(page, `SAFE-01.section.${section}`)).toBeVisible();
    await expect(id(page, 'SAFE-01.facts')).not.toBeEmpty();
    await expect(id(page, 'SAFE-01.groundLink')).toBeVisible();
    await expect(id(page, 'SAFE-01.reporterNote')).toHaveCount(0);
    await expect(id(page, 'SAFE-01.disputeLink')).toBeVisible();

    const reporter = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] });
    try {
      await applyAuth(reporter.context, 'member-reporter');
      await reporter.page.goto(qaUrl(`/app/decision/${SEEDED_DECISION}`, { theme: 'carbon', locale: 'de' }));
      await expect(id(reporter.page, 'SAFE-01.reporterNote')).toBeVisible();
      await expect(id(reporter.page, 'SAFE-01.title')).toHaveText(de('safety', 'decision.titleReporter'));
      for (const hiddenPart of ['SAFE-01.facts', 'SAFE-01.groundText', 'SAFE-01.scope', 'SAFE-01.section.facts', 'SAFE-01.section.ground']) {
        await expect(id(reporter.page, hiddenPart), `${hiddenPart} is for the affected member only`).toHaveCount(0);
      }
      const api = await memberApi(await sessionOf(DEMO_REPORTER));
      const decision = expectStatus(await api.get(`decisions/${SEEDED_DECISION}`), 200, 'GET decision as the reporter').data;
      await api.dispose();
      expect(decision).toMatchObject({ viewer: 'reporter', action: null, restriction: null, statement: null, ground_document: null });
    } finally {
      await reporter.context.close();
    }
  });

  test('an appeal of the affected member: Einspruch einlegen → sent; the decision then reads it and offers no second one', async ({ page, context }, testInfo) => {
    test.setTimeout(150_000);
    const [reporter, affected] = await members('f6appealreporter', 'f6appealaffected');
    await named(affected, 'Ole Petersen');
    expectStatus(await reporter.api.post('reports', { target_type: 'member', target_id: affected.username, reason: 'impersonation' }), 201, 'POST reports');
    const { decision_id: decisionId } = await decideTestCase(affected.email);

    await useSession(context, affected.session);
    await open(page, `/app/decision/${decisionId}`);
    await expect(id(page, 'SAFE-01.appeal.open')).toBeVisible();
    await id(page, 'SAFE-01.appealButton').click();
    await expect(id(page, 'SAFE-01.appealSheet')).toBeVisible();
    await flowShot(page, testInfo, 'SAFE-01-appealSheet');
    await id(page, 'SAFE-01.appealSheet.text').fill('Das ist mein eigenes Profil, ich habe nichts nachgeahmt. Bitte prüft das noch einmal.');
    const appealed = page.waitForResponse(isCall('POST', `decisions/${decisionId}/appeal`));
    await id(page, 'SAFE-01.appealSheet.send').click();
    expect((await appealed).status()).toBe(201);
    await expect(id(page, 'SAFE-01.appealSheet.sent')).toBeVisible();
    await flowShot(page, testInfo, 'SAFE-01-appealSheet-sent');
    await id(page, 'SAFE-01.appealSheet.done').click();

    await page.reload();
    await expect(id(page, 'SAFE-01.title')).toBeVisible();
    await expect(id(page, 'SAFE-01.appeal.open')).toHaveCount(0);
    const decision = expectStatus(await affected.api.get(`decisions/${decisionId}`), 200, 'GET decision').data;
    expect(decision.can_appeal).toBe(false);
    expect(decision.appeal?.status).toBe('open');
    const twice = await affected.api.post(`decisions/${decisionId}/appeal`, { text: 'Noch einmal' });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('appeal_exists');
  });
});

test.describe('F6 WEB-09 /melden', () => {
  test('a guest reports a public build: errors in place, then the confirmation page', async ({ page, expectFailedResponses }, testInfo) => {
    test.setTimeout(120_000);
    const [owner] = await members('f6webowner');
    const vehicle = await buildVehicle(owner.api);
    expectFailedResponses([{ status: 422, url: webPath('/melden') }]);

    await page.goto('/melden');
    await expect(page.locator('[data-testid="WEB-09.root"][data-state="form"]')).toBeVisible();
    // Sent empty: the summary at the top, each field marked, nothing filed.
    const empty = page.waitForResponse((r) => new URL(r.url()).pathname === '/melden' && r.request().method() === 'POST');
    await page.getByTestId('WEB-09.submit').click();
    expect((await empty).status()).toBe(422);
    await expect(page.getByTestId('WEB-09.errors')).toBeVisible();
    await expect(page.getByTestId('WEB-09.url')).toHaveAttribute('aria-invalid', 'true');
    await flowShot(page, testInfo, 'WEB-09-errors');

    await page.getByTestId('WEB-09.url').fill(`${new URL(BASE_URL).host}/v/${vehicle.slug}`);
    await page.getByTestId('WEB-09.reason.harassment').check();
    await page.getByTestId('WEB-09.details').fill('Der Besitzer beleidigt in der Beschreibung andere Fahrer.');
    await page.getByTestId('WEB-09.goodFaith').check();
    const sent = page.waitForResponse((r) => new URL(r.url()).pathname === '/melden' && r.request().method() === 'POST');
    await page.getByTestId('WEB-09.submit').click();
    expect((await sent).status()).toBe(303);
    await expect.poll(() => pathOf(page)).toBe('/melden/gesendet');
    await expect(page.locator('[data-testid="WEB-09.root"][data-state="sent"]')).toBeVisible();
    await expect(page.getByTestId('WEB-09.sent.title')).toBeVisible();
  });

  test('a cross-site POST is refused and files nothing', async ({ page }) => {
    const answer = await page.request.post(`${BASE_URL}/melden`, {
      form: { url: '/v/nissan-skyline-gt-r-r34-5tf974vj', reason: 'spam', details: 'Werbung für einen Shop im Text.', good_faith: '1' },
      headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' },
      maxRedirects: 0,
    });
    expect(answer.status()).toBe(422);
    expect(await answer.text()).toContain('data-testid="WEB-09.form.error"');
  });
});
