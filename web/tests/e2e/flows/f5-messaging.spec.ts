// F5, the messaging half (02_PRODUCT_SPEC §4 F5, 04_SCREEN_REGISTER §6 "F5 … PROF-02 → MSG-02"; m2.4-api-handover.md): PROF-02
// Nachricht → MSG-03 → send, and the recipient who does not follow the sender finds it in Anfragen; the optimistic send and its
// dedupe (a send whose answer was lost and an idempotent replay never make a second message); the other member's reply arriving by
// polling; a start from VEH-01 that carries the vehicle as the context card; a photo message; pin, mute and archive; delete for me and
// the revive by a later message.
//
// Every conversation is between members of this spec (support/garage.mjs createGarageMember); the demo conversations the matrix
// photographs are never opened here. Realtime is off locally (no Pusher keys, BROADCAST_CONNECTION=log), so everything arrives by
// polling, which the contract guarantees without Pusher. The browser's clock is fixed (qaNow) while the server's runs: a mute
// computed from the fixed clock would lie in the server's past, so the organise test runs its page on the real clock.
import type { Page, Request, Route } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import {
  apiPath,
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
  sendText,
  startConversation,
  thread,
  type Member,
} from '../support/flow';
import { buildVehicle, expectStatus, photoFile } from '../support/garage.mjs';
import { expectTextContaining } from '../support/text.mjs';

const message = (page: Page, routeId: string, text: string) => page.locator(`[data-testid^="${routeId}.message."][data-testid$=".press"]:visible`).filter({ hasText: text });
const composer = (page: Page, routeId: string) => id(page, `${routeId}.composer.input`);

/** An accepted chat: `b` follows `a` before `a` writes, so the first message lands in b's Chats (handover §3). */
async function chat(a: Member, b: Member, first = 'Servus, kurze Frage zum Fahrwerk.'): Promise<string> {
  await follow(b, a.username);
  const started = await startConversation(a, b.username, first);
  expect(started.conversation.request_pending).toBe(false);
  return started.conversation.id;
}

test.describe('F5 messaging: start and request', () => {
  test('PROF-02 Nachricht → MSG-03 → send; a recipient who does not follow the sender gets it in Anfragen', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(120_000);
    const [sender, recipient] = await members('f5msgfrom', 'f5msgto');
    await named(sender, 'Mara Schulz');
    await useSession(context, sender.session);
    const text = 'Hi, ist das ein KW V3 bei dir?';

    await open(page, `/app/u/${recipient.username}`);
    await id(page, 'PROF-02.message').click();
    await expect(id(page, 'MSG-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('to')).toBe(recipient.username);
    await expect(id(page, 'MSG-03.recipient')).toContainText(`@${recipient.username}`);

    const started = page.waitForResponse(isCall('POST', 'conversations'));
    await composer(page, 'MSG-03').fill(text);
    await id(page, 'MSG-03.composer.send').click();
    const answer = await started;
    expect(answer.status()).toBe(201);
    const { conversation } = (await answer.json()).data;
    expect(conversation.request_pending).toBe(true);

    // The sender lands in the thread with the message and the calm "waiting" note instead of a composer.
    await expect.poll(() => pathOf(page)).toBe(`/app/messages/${conversation.id}`);
    await expect(message(page, 'MSG-02', text)).toHaveCount(1);
    await expect(id(page, 'MSG-02.requestPending')).toBeVisible();
    await expect(id(page, 'MSG-02.composer')).toHaveCount(0);

    // The recipient: Anfragen, not Chats, and the tab says how many.
    expect((await inbox(recipient, 'requests')).map((c) => c.other?.username)).toEqual([sender.username]);
    expect(await inbox(recipient, 'chats')).toEqual([]);
    const other = await browserOf(browser, recipient, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(other.page, '/app/messages?folder=requests');
      await expect(id(other.page, 'MSG-01.tabs.requests')).toHaveText(de('messages', 'inbox.requestsCount', { value: '1' }));
      await expect(id(other.page, `MSG-01.row.${conversation.id}`)).toContainText(text);
      await open(other.page, '/app/messages');
      await expect(id(other.page, 'MSG-01.emptyChats')).toBeVisible();
    } finally {
      await other.context.close();
    }
  });

  test('VEH-01 Nachricht starts a conversation about the build: MSG-03 shows it, MSG-02 carries the context card', async ({ page, context }) => {
    test.setTimeout(120_000);
    const [owner, writer] = await members('f5vehowner', 'f5vehwriter');
    const vehicle = await buildVehicle(owner.api);
    await useSession(context, writer.session);

    await open(page, `/app/v/${vehicle.slug}`);
    // M4.9: Nachricht sits in the action row under the owner row (09 §7.6 (4)).
    await id(page, 'VEH-01.actions.message').first().click();
    await expect(id(page, 'MSG-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('about')).toBe(vehicle.slug);
    // Titles carry a word joiner after the hyphen ("GT-\u2060R"); expectTextContaining compares what a reader sees.
    await expectTextContaining(id(page, 'MSG-03.about'), 'Skyline GT-R');

    const started = page.waitForResponse(isCall('POST', 'conversations'));
    await composer(page, 'MSG-03').fill('Ist der Wagen noch im Originallack?');
    await id(page, 'MSG-03.composer.send').click();
    const answer = await started;
    expect(answer.status()).toBe(201);
    expect(answer.request().postDataJSON()).toMatchObject({ recipient: owner.username, vehicle_id: vehicle.id, message: { type: 'text' } });
    const { conversation } = (await answer.json()).data;
    expect(conversation.context_vehicle?.slug).toBe(vehicle.slug);

    await expect.poll(() => pathOf(page)).toBe(`/app/messages/${conversation.id}`);
    // The writer's own thread shows the card; it opens the build.
    await expectTextContaining(id(page, 'MSG-02.context'), 'Skyline GT-R');
    await id(page, 'MSG-02.context.open').click();
    await expect.poll(() => pathOf(page)).toBe(`/app/v/${vehicle.slug}`);
    // The owner sees the same card on his side.
    const detail = expectStatus(await owner.api.get(`conversations/${conversation.id}`), 200, 'GET conversation as owner').data;
    expect(detail.context_vehicle?.slug).toBe(vehicle.slug);
  });
});

test.describe('F5 messaging: sending', () => {
  test('a message shows at once, before the server answers, and lands once', async ({ page, context }) => {
    test.setTimeout(120_000);
    const [me, other] = await members('f5optimistic', 'f5optimisticb');
    const conversationId = await chat(me, other);
    await useSession(context, me.session);
    await open(page, `/app/messages/${conversationId}`);
    await expect(id(page, 'MSG-02.composer')).toBeVisible();

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const path = apiPath(`conversations/${conversationId}/messages`);
    await page.route(path, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await held;
      return route.continue();
    });
    const text = 'Samstag Nordschleife, kommst du mit?';
    const sent = page.waitForResponse(isCall('POST', `conversations/${conversationId}/messages`));
    await composer(page, 'MSG-02').fill(text);
    await composer(page, 'MSG-02').press('Enter');
    // Optimistic: the bubble is there and the field empty while the request is still held.
    await expect(message(page, 'MSG-02', text)).toHaveCount(1);
    await expect(composer(page, 'MSG-02')).toHaveValue('');
    release();
    expect((await sent).status()).toBe(201);
    await page.unroute(path);

    // Still one after the server's copy replaced the outbox entry, and after a reload.
    await expect(message(page, 'MSG-02', text)).toHaveCount(1);
    await page.reload();
    await expect(message(page, 'MSG-02', text)).toHaveCount(1);
    expect((await thread(other, conversationId)).filter((m) => m.body === text)).toHaveLength(1);
  });

  test('a send whose answer was lost goes again and stays one message; an idempotent replay answers the first', async ({ page, context, expectFailedResponses }) => {
    test.setTimeout(120_000);
    const [me, other] = await members('f5dedupe', 'f5dedupeb');
    const conversationId = await chat(me, other);
    await useSession(context, me.session);
    await open(page, `/app/messages/${conversationId}`);
    await expect(id(page, 'MSG-02.composer')).toBeVisible();

    // The first POST reaches the server, but its answer never reaches the app (a dropped connection).
    expectFailedResponses([{ status: 'network', url: apiPath(`conversations/${conversationId}/messages`) }]);
    const path = apiPath(`conversations/${conversationId}/messages`);
    let first: Request | null = null;
    // The thread's poll would find the server's copy and settle the entry by its client_id without a second POST (outbox.ts
    // `reconcile`, by contract); which comes first is a matter of timers (2 s retry, 3 s poll, the poll on load). This test is about
    // the retry, so the polls that start after the lost answer wait, like a slow connection, until the retry has its answer.
    let replayAnswered = (): void => undefined;
    const answered = new Promise<void>((resolve) => (replayAnswered = resolve));
    await page.route(path, async (route: Route) => {
      const request = route.request();
      if (request.method() === 'GET' && first && new URL(request.url()).searchParams.has('after')) {
        await answered;
        return route.continue().catch(() => undefined);
      }
      if (request.method() !== 'POST' || first) return route.continue();
      first = request;
      await route.fetch();
      await route.abort('connectionreset');
    });
    const text = 'Hast du die Spurplatten noch?';
    await composer(page, 'MSG-02').fill(text);
    await composer(page, 'MSG-02').press('Enter');

    // The outbox tries again by itself or offers "Erneut senden"; either way the second POST is a replay of the first.
    const replay = page.waitForResponse((r) => isCall('POST', `conversations/${conversationId}/messages`)(r) && r.request() !== first, { timeout: 45_000 });
    const retry = page.locator('[data-testid^="MSG-02.message."][data-testid$=".retry"]:visible');
    await Promise.race([replay, retry.first().waitFor({ timeout: 45_000 }).then(() => retry.first().click()).catch(() => undefined)]);
    const second = await replay;
    replayAnswered();
    expect(second.status(), 'the retry of a stored message is answered as a replay').toBe(200);
    expect(second.headers()['idempotency-replayed']).toBe('true');
    expect(second.request().postDataJSON().client_id).toBe((first as Request | null)?.postDataJSON().client_id);
    await page.unroute(path);

    await expect(message(page, 'MSG-02', text)).toHaveCount(1);
    await expect(page.locator('[data-testid^="MSG-02.message."][data-testid$=".failed"]:visible')).toHaveCount(0);
    const stored = (await thread(me, conversationId)).filter((m) => m.body === text);
    expect(stored).toHaveLength(1);

    // The same client id and Idempotency-Key again, from outside: the stored message, 200, no second row.
    const body = (first as Request | null)?.postDataJSON();
    const key = (first as Request | null)?.headers()['idempotency-key'];
    const again = await me.api.post(`conversations/${conversationId}/messages`, body, { key });
    expect(again.status).toBe(200);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(again.body.data.id).toBe(stored[0]?.id);
    // The same key with another text is refused, never stored.
    const reused = await me.api.post(`conversations/${conversationId}/messages`, { ...body, body: 'Anderer Text' }, { key });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('idempotency_key_reused');
    expect((await thread(other, conversationId)).filter((m) => m.body === text)).toHaveLength(1);
  });

  test('Enter sends, Shift+Enter makes a new line', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [me, other] = await members('f5enter', 'f5enterb');
    const conversationId = await chat(me, other);
    await useSession(context, me.session);
    await open(page, `/app/messages/${conversationId}`);
    const field = composer(page, 'MSG-02');
    await field.click();
    await field.pressSequentially('Erste Zeile');
    await field.press('Shift+Enter');
    await field.pressSequentially('zweite Zeile');
    await expect(field).toHaveValue('Erste Zeile\nzweite Zeile');
    const sent = page.waitForResponse(isCall('POST', `conversations/${conversationId}/messages`));
    await field.press('Enter');
    expect((await sent).request().postDataJSON().body).toBe('Erste Zeile\nzweite Zeile');
    await expect(field).toHaveValue('');
  });

  test("after polling the thread shows the other member's reply, and reading it clears the unread count", async ({ page, context }) => {
    test.setTimeout(90_000);
    const [me, other] = await members('f5poll', 'f5pollb');
    await named(other, 'Jonas Becker');
    const conversationId = await chat(me, other);
    await useSession(context, me.session);
    await open(page, `/app/messages/${conversationId}`);
    await expect(id(page, 'MSG-02.composer')).toBeVisible();

    const reply = 'Ja, Samstag 9 Uhr am Parkplatz Döttinger Höhe.';
    await sendText(other, conversationId, reply);
    // Polling every 3 s while the thread is in front (contract §3), no reload.
    const bubble = message(page, 'MSG-02', reply);
    await expect(bubble).toHaveCount(1, { timeout: 15_000 });
    // The name starts with the visible text (WCAG 2.5.3) and says who wrote it.
    await expect(bubble).toHaveAttribute('aria-label', new RegExp(`^${reply.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*${de('messages', 'thread.messageFrom', { name: 'Jonas Becker' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    await expect.poll(async () => (await inbox(me)).find((c) => c.id === conversationId)?.unread_count, { timeout: 15_000 }).toBe(0);
  });

  test('a photo message: attach, upload, the photo in the thread for both', async ({ page, context }) => {
    test.setTimeout(150_000);
    const [me, other] = await members('f5photo', 'f5photob');
    const conversationId = await chat(me, other);
    await useSession(context, me.session);
    await open(page, `/app/messages/${conversationId}`);
    await id(page, 'MSG-02.composer.attach').click();
    await expect(id(page, 'MSG-02.attach')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    const uploaded = page.waitForResponse(isCall('POST', `conversations/${conversationId}/media`), { timeout: 90_000 });
    await row(page, 'MSG-02.attach.photo').click();
    await (await chooser).setFiles(photoFile('generic-wheels-01.jpg'));
    expect((await uploaded).status()).toBe(201);
    const sent = await page.waitForResponse(isCall('POST', `conversations/${conversationId}/messages`), { timeout: 60_000 });
    expect(sent.status()).toBe(201);
    expect(sent.request().postDataJSON().type).toBe('photo');

    // The other member gets the photo as a signed private URL that answers an image.
    const theirs = (await thread(other, conversationId)).find((m) => m.type === 'photo') as unknown as { media: { variants: { url: string }[] } } | undefined;
    const url = theirs?.media?.variants?.[0]?.url;
    expect(url, 'the photo message carries signed variants').toBeTruthy();
    const image = await page.request.get(url as string);
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toMatch(/^image\//);
    // And the sender sees it in the thread, with a real size (not a collapsed bubble).
    const photo = page.locator('[data-testid^="MSG-02.message."][data-testid$=".photo"]');
    await expect(photo).toHaveCount(1);
    await expect(photo, 'the photo bubble has a size on screen').toBeVisible();
    const box = await photo.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
  });
});

test.describe('F5 messaging: organise', () => {
  test('pin, mute and archive from the inbox; a muted archived chat stays archived when a message comes', async ({ page, context }, testInfo) => {
    test.setTimeout(150_000);
    const [me, other, third] = await members('f5organise', 'f5organiseb', 'f5organisec');
    await named(other, 'Lea Hartmann');
    const conversationId = await chat(other, me);
    // A second chat stays in Chats, so the folder is not empty once the first is archived.
    await chat(third, me, 'Kommst du Sonntag zum Treffen?');
    await useSession(context, me.session);
    // The real clock: a mute is "now + 8 h" on the device, and the server refuses a moment in its past.
    await page.clock.setFixedTime(new Date());
    const realNow = new Date().toISOString();
    await open(page, '/app/messages', { now: realNow });
    const conversationRow = id(page, `MSG-01.row.${conversationId}`);
    await expect(conversationRow).toBeVisible();

    // Pin.
    await id(page, `MSG-01.row.${conversationId}.more`).click();
    await expect(id(page, 'MSG-01.organise')).toBeVisible();
    await flowShot(page, testInfo, 'MSG-01-organiseSheet');
    const pinned = page.waitForResponse(isCall('PATCH', `conversations/${conversationId}`));
    await row(page, 'MSG-01.organise.pin').click();
    expect((await pinned).status()).toBe(200);
    await expect(id(page, 'MSG-01.toast')).toHaveText(de('messages', 'organise.pinned'));
    await expect(id(page, `MSG-01.row.${conversationId}.pinned`)).toBeVisible();
    expect((await inbox(me)).find((c) => c.id === conversationId)?.pinned_at).not.toBeNull();

    // Mute for 8 hours.
    await id(page, `MSG-01.row.${conversationId}.more`).click();
    await row(page, 'MSG-01.organise.mute').click();
    await expect(id(page, 'MSG-01.mute')).toBeVisible();
    await flowShot(page, testInfo, 'MSG-01-muteSheet');
    const muted = page.waitForResponse(isCall('PATCH', `conversations/${conversationId}`));
    await row(page, 'MSG-01.mute.hours').click();
    expect((await muted).status()).toBe(200);
    await expect(id(page, `MSG-01.row.${conversationId}.muted`)).toBeVisible();
    expect((await inbox(me)).find((c) => c.id === conversationId)?.muted_until).not.toBeNull();

    // Archive: gone from Chats, there under Archiviert.
    await id(page, `MSG-01.row.${conversationId}.more`).click();
    const archived = page.waitForResponse(isCall('PATCH', `conversations/${conversationId}`));
    await row(page, 'MSG-01.organise.archive').click();
    expect((await archived).status()).toBe(200);
    await expect(conversationRow).toHaveCount(0);
    await row(page, 'MSG-01.archived').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('folder')).toBe('archived');
    await expect(id(page, `MSG-01.row.${conversationId}`)).toBeVisible();

    // A new message: archived and muted, so it stays in Archiviert (handover §3).
    await sendText(other, conversationId, 'Noch da?');
    expect((await inbox(me, 'archived')).map((c) => c.id)).toContain(conversationId);
    expect((await inbox(me, 'chats')).map((c) => c.id)).not.toContain(conversationId);
  });

  test('Archiviert stays reachable when every chat is archived', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [me, other] = await members('f5archiveonly', 'f5archiveonlyb');
    const conversationId = await chat(other, me);
    expectStatus(await me.api.patch(`conversations/${conversationId}`, { archived: true }), 200, 'archive');
    await useSession(context, me.session);
    await open(page, '/app/messages');
    await expect(id(page, 'MSG-01.emptyChats')).toBeVisible();
    // The empty Chats folder must still lead to the archived chat.
    await row(page, 'MSG-01.archived').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('folder')).toBe('archived');
    await expect(id(page, `MSG-01.row.${conversationId}`)).toBeVisible();
  });

  test('"Bis du es wieder änderst" mutes a chat', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [me, other] = await members('f5mutealways', 'f5mutealwaysb');
    const conversationId = await chat(other, me);
    await useSession(context, me.session);
    await page.clock.setFixedTime(new Date());
    await open(page, '/app/messages', { now: new Date().toISOString() });
    await id(page, `MSG-01.row.${conversationId}.more`).click();
    await row(page, 'MSG-01.organise.mute').click();
    const muted = page.waitForResponse(isCall('PATCH', `conversations/${conversationId}`));
    await row(page, 'MSG-01.mute.always').click();
    // The server takes a mute of at most one year (OrganiseConversationRequest); the option must stay inside it.
    expect((await muted).status()).toBe(200);
    await expect(id(page, 'MSG-01.toast')).toHaveText(de('messages', 'organise.muted'));
    await expect(id(page, `MSG-01.row.${conversationId}.muted`)).toBeVisible();
  });

  test('delete for me hides the conversation; a later message of the other side revives it with only what came after', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const [me, other] = await members('f5delete', 'f5deleteb');
    const old = 'Alte Nachricht vor dem Löschen';
    const conversationId = await chat(other, me, old);
    await useSession(context, me.session);
    await open(page, '/app/messages');
    await id(page, `MSG-01.row.${conversationId}.more`).click();
    await row(page, 'MSG-01.organise.delete').click();
    await expect(id(page, 'MSG-01.deleteDialog')).toBeVisible();
    await flowShot(page, testInfo, 'MSG-01-deleteDialog');
    const deleted = page.waitForResponse(isCall('DELETE', `conversations/${conversationId}`));
    await id(page, 'MSG-01.deleteDialog.confirm').click();
    expect((await deleted).status()).toBe(204);
    await expect(id(page, 'MSG-01.toast')).toHaveText(de('messages', 'organise.deleted'));
    await expect(id(page, `MSG-01.row.${conversationId}`)).toHaveCount(0);
    for (const folder of ['chats', 'requests', 'archived'] as const) expect((await inbox(me, folder)).map((c) => c.id)).not.toContain(conversationId);
    // The other side keeps everything.
    expect((await thread(other, conversationId)).map((m) => m.body)).toContain(old);

    const fresh = 'Neue Nachricht danach';
    await sendText(other, conversationId, fresh);
    expect((await inbox(me)).map((c) => c.id)).toContain(conversationId);
    await open(page, `/app/messages/${conversationId}`);
    await expect(message(page, 'MSG-02', fresh)).toHaveCount(1);
    await expect(message(page, 'MSG-02', old)).toHaveCount(0);
    expect((await thread(me, conversationId)).map((m) => m.body)).toEqual([fresh]);
  });
});
